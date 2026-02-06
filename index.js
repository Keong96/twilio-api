const express = require('express');
const twilio = require('twilio');
const jwt = require("jsonwebtoken");
const bodyParser = require("body-parser");
const { Client } = require('pg');
const { Parser } = require('json2csv');
require('dotenv').config();
const AccessToken = twilio.jwt.AccessToken;
const VoiceGrant = AccessToken.VoiceGrant;
const VoiceResponse = require('twilio').twiml.VoiceResponse;
const app = express();
const path = require('path');

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_TWIML_APP_SID = process.env.TWILIO_TWIML_APP_SID;
const TWILIO_API_KEY = process.env.TWILIO_API_KEY;
const TWILIO_API_SECRET = process.env.TWILIO_API_SECRET;
const PORT = process.env.PORT || 3000;

const BASE_URL = process.env.BASE_URL; 

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

const twilio_client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

const config = {
  connectionString: process.env.DB
};

const client = new Client(config);
client.connect();

function GenerateJWT(_userId, _email) {
  return jwt.sign(
    { userId: _userId, email: _email},
    process.env.TOKEN_KEY,
    { expiresIn: "24h" }
  );
}

function verifyToken(req, res, next) {
  const authHeader = req.headers["authorization"];

  if (authHeader) {
    const token = authHeader.split(" ")[1];
    jwt.verify(token, process.env.TOKEN_KEY, (err, user) => {
      if (err) {
        return res.sendStatus(403);
      }

      req.user = user;
      next();
    });
  } else {
    res.sendStatus(401);
  }
}

function normalizePhoneNumber(number) {
  if (!number) return number;
  let str = number.toString().trim().replace(/\s+/g, '');
  
  if (str.startsWith('0')) {
    return '+6' + str;
  }
  
  if (str.startsWith('60')) {
    return '+' + str;
  }
  
  if (!str.startsWith('+')) {
    return '+' + str;
  }
  
  return str;
}

// WebRTC Token Generation
app.post('/get-token', (req, res) => {
  const identity  = req.body.phoneNumber;

  const voiceGrant = new VoiceGrant({
    outgoingApplicationSid: TWILIO_TWIML_APP_SID,
    incomingAllow: true
  });

  const token = new AccessToken(TWILIO_ACCOUNT_SID, TWILIO_API_KEY, TWILIO_API_SECRET, {identity});
  token.addGrant(voiceGrant);

  res.json({ token: token.toJwt() });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// 登录
app.post('/login', async (req, res) => {
  if (!req.body.email || !req.body.password) {
    return res.status(200).json({
      status: false,
      data: {},
      message: "Error: Please enter your email and password to login.",
    });
  }

  client.query(
    "SELECT * FROM users WHERE email = $1 AND password = crypt($2, password)",
    [req.body.email, req.body.password]
  )
  .then((result) => {
    if (result.rows.length > 0) {
      const user = result.rows[0];

      if (!user.status) {
        return res.status(200).json({
          status: false,
          data: {},
          message: "Account suspended",
        });
      }

      const token = GenerateJWT(user.id, user.email);
      res.status(200).json({
        status: true,
        data: {
          userId: user.id,
          token: token,
        },
        message: ""
      });
    } else {
      return res.status(200).json({
        status: false,
        data: {},
        message: "Error: Wrong email or Password",
      });
    }
  })
  .catch((e) => {
    console.error(e.stack);
    res.status(500).send(e.stack);
  });
});

app.get('/phone-numbers', verifyToken, async(req, res) => {
  const result = await client.query('SELECT phone_number FROM phone_numbers WHERE user_id = $1 AND deleted_at IS NULL', [req.user.userId]);
  const phoneNumbers = result.rows.map(row => row.phone_number);
  return res.status(200).json(phoneNumbers);
});

app.get("/get-cover-name/:phoneNumber", verifyToken, async (req, res) => {
  const { phoneNumber } = req.params;
  try {
    const result = await client.query("SELECT cover_name FROM phone_numbers WHERE phone_number = $1 AND deleted_at IS NULL", [phoneNumber]);
    return res.status(200).json(result.rows[0].cover_name);
  } catch (error) {
    console.error("Error fetching cover name:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// 處理來電 Webhook
app.post('/call', express.urlencoded({ extended: false }), async (req, res) => {
    const response = new twilio.twiml.VoiceResponse();

    const isInbound = req.body.Direction === 'inbound';
    const phoneNumber = isInbound ? req.body.To : req.body.From;
    const selectedLanguage = (await client.query('SELECT language FROM phone_numbers WHERE phone_number = $1', [phoneNumber])).rows[0]?.language;
    const cover_name = (await client.query('SELECT cover_name FROM phone_numbers WHERE phone_number = $1', [phoneNumber])).rows[0]?.cover_name;

    const result = await client.query('SELECT * FROM phone_settings WHERE phone_number = $1 ORDER BY digit ASC', [phoneNumber]);
    const ivrSettings =  result.rows;

    if (ivrSettings.length === 0) {
      if (selectedLanguage === 'cmn') {
        response.say(
          { language: 'cmn-CN', voice: 'Polly.Zhiyu' },
          '<speak><prosody rate="slow">当前没有可用的选项，请稍后再试。</prosody></speak>'
        );
      } else if (selectedLanguage === 'en') {
        response.say(
          { language: 'en-US', voice: 'Polly.Joanna' },
          '<speak><prosody rate="slow">There are currently no available options, please try again later.</prosody></speak>'
        );
      } else if (selectedLanguage === 'ms') {
        response.say(
          { language: 'ms-MY', voice: 'Google.ms-MY-Standard-A' },
          '<speak><prosody rate="slow">Tiada pilihan yang tersedia pada masa ini, sila cuba lagi kemudian.</prosody></speak>'
        );
      }
      response.hangup();
      res.type('text/xml').send(response.toString());
      return;
    }
    
    let ivrMenuText = '';
    if (selectedLanguage === 'cmn') {

      if(cover_name)
        ivrMenuText = `欢迎致电 ${cover_name} <break time="1s"/>`;
      else
        ivrMenuText = '欢迎致电，<break time="1s"/>';

      ivrSettings.forEach(setting => {
        if(setting.digit && setting.content && setting.redirect_to)
          ivrMenuText += `按 ${setting.digit}，${setting.content}，`;
      });
    } else if (selectedLanguage === 'en') {

      if(cover_name)
        ivrMenuText = `Welcome to ${cover_name} <break time="1s"/>`;
      else
        ivrMenuText = 'Welcome,  <break time="1s"/>';

      ivrSettings.forEach(setting => {
        if(setting.digit && setting.content && setting.redirect_to)
          ivrMenuText += `${setting.content}, please press ${setting.digit}.`;
      });
    } else if (selectedLanguage === 'ms') {

      if(cover_name)
        ivrMenuText = `Selamat datang ke ${cover_name} <break time="1s"/>`;
      else
        ivrMenuText = 'Selamat datang, <break time="1s"/>';

      ivrSettings.forEach(setting => {
        if(setting.digit && setting.content && setting.redirect_to)
          ivrMenuText += `Tekan ${setting.digit} untuk ${setting.content}, `;
      });
    }

    const gather = response.gather({
      numDigits: 1,
      action: `${BASE_URL}/process-input`,
      method: 'POST',
    });

    if (selectedLanguage === 'cmn') {
      gather.say(
        { language: 'cmn-CN', voice: 'Polly.Zhiyu' },
        `<speak><prosody rate="slow">${ivrMenuText}</prosody></speak>`
      );
    } else if (selectedLanguage === 'en') {
      gather.say(
        { language: 'en-US', voice: 'Polly.Joanna' },
        `<speak><prosody rate="slow">${ivrMenuText}</prosody></speak>`
      );
    } else if (selectedLanguage === 'ms') {
      gather.say(
        { language: 'ms-MY', voice: 'Google.ms-MY-Standard-A' },
        `<speak><prosody rate="slow">${ivrMenuText}</prosody></speak>`
      );
    }

    res.type('text/xml');
    res.send(response.toString());
});

// 處理來電 Webhook
app.post('/call-not-available', express.urlencoded({ extended: false }), async (req, res) => {
  const response = new twilio.twiml.VoiceResponse();

  response.say(
  { language: 'en-US', voice: 'Polly.Joanna' },
    '<speak><prosody rate="slow">Thank you for calling our customer service careline, we will contact you shortly.</prosody></speak>'
  );
  response.hangup();
  res.type('text/xml').send(response.toString());
  return;
});

// 處理來電 Webhook
app.post('/direct-transfer/:number', express.urlencoded({ extended: false }), (req, res) => {
  const response = new twilio.twiml.VoiceResponse();
  const forwardTo = req.params.number; // e.g. +60123456789

  response.dial(forwardTo);
  res.type('text/xml').send(response.toString());
});

// 處理用戶輸入
app.post('/process-input', express.urlencoded({ extended: false }), async (req, res) => {
    const response = new twilio.twiml.VoiceResponse();
    const userInput = req.body.Digits;
    const phoneNumber = req.body.To;
    const selectedLanguage = (await client.query('SELECT language FROM phone_numbers WHERE phone_number = $1', [phoneNumber])).rows[0]?.language;
    const result = await client.query('SELECT * FROM phone_settings WHERE phone_number = $1', [phoneNumber]);

    const settings = result.rows.find(row => row.digit === Number(userInput));

    if (settings) {
      if (selectedLanguage === 'cmn') {
        response.say(
          { language: 'cmn-CN', voice: 'Polly.Zhiyu' },
          '<speak><prosody rate="slow">请稍候，我们正在为您转接。</prosody></speak>'
        );
      } else if (selectedLanguage === 'en') {
        response.say(
          { language: 'en-US', voice: 'Polly.Joanna' },
          '<speak><prosody rate="slow">Please wait, we are transferring your call.</prosody></speak>'
        );
      } else if (selectedLanguage === 'ms') {
        response.say(
          { language: 'ms-MY', voice: 'Google.ms-MY-Standard-A' },
          '<speak><prosody rate="slow">Sila tunggu, kami sedang memindahkan panggilan anda.</prosody></speak>'
        );
      }
      
      response.pause({ length: 2 });
      let dialOptions = { answerOnBridge: false };

      dialOptions.callerId = phoneNumber;
      
      // if (result.rows[0].cover_number) {
      //   dialOptions.callerId = phoneNumber;
      // }

      const targetNumber = normalizePhoneNumber(settings.redirect_to);
      
      console.log('Redirecting to:', targetNumber);
      response.dial(dialOptions, targetNumber);
      
    } else {
      if (selectedLanguage === 'cmn') {
        response.say({ language: 'cmn-CN', voice: 'Polly.Zhiyu' }, '<speak><prosody rate="slow">無效的選擇，請重試。</prosody></speak>');
      } else if (selectedLanguage === 'en') {
        response.say({ language: 'en-US', voice: 'Polly.Joanna' }, '<speak><prosody rate="slow">Invalid selection, please try again.</prosody></speak>');
      } else if (selectedLanguage === 'ms') {
        response.say({ language: 'ms-MY', voice: 'Google.ms-MY-Standard-A' }, '<speak><prosody rate="slow">Pilihan tidak sah, sila cuba lagi.</prosody></speak>');
      }      
      const gather = response.gather({
        numDigits: 1,
        action: `${BASE_URL}/process-input`,
        method: 'POST'
      });
    }

    res.type('text/xml');
    res.send(response.toString());
});

// 測試撥打電話
app.post('/make-call', async (req, res) => {
  const phoneNumber = normalizePhoneNumber(req.body.phoneNumber); 
  const to = normalizePhoneNumber(req.body.to);

  try {
    const result = await client.query(
      'SELECT * FROM phone_numbers WHERE phone_number = $1 AND deleted_at IS NULL',
      [phoneNumber]
    );

    if (result.rows.length === 0) {
      return res.json({ message: 'Phone number not found or deleted' });
    }

    const conferenceRoom = "ROOM-" + phoneNumber.replace('+', '');

    const call = await twilio_client.calls.create({
      url: `${BASE_URL}/voice-response?room=${encodeURIComponent(conferenceRoom)}`,
      to: to,
      from: phoneNumber,
    });

    res.json({ message: 'Call initiated', callSid: call.sid });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error initiating call', error: error.message });
  }
});

// app.post('/voice-response', async (req, res) => {  
//   const twiml = new twilio.twiml.VoiceResponse();
//   const caller = req.body.Caller || '';
//   const conferenceRoom = "ROOM-"+caller.replace(/^client:/, '');

//   try {
//     const conferences = await twilio_client.conferences.list({
//       friendlyName: conferenceRoom,
//       status: 'in-progress'
//     });

//     if (conferences.length > 0) {
//       const activeConference = conferences[0];
//       const participants = await twilio_client.conferences(activeConference.sid)
//         .participants
//         .list();

//       if (participants.length >= 2) {
//         twiml.reject();
//         return res.type('text/xml').send(twiml.toString());
//       }
      
//       const duplicate = participants.find(p => p.callSid === req.body.CallSid);
//       if (duplicate) {
//         twiml.reject();
//         return res.type('text/xml').send(twiml.toString());
//       }
//     }
//   } catch (error) {
//     console.error("Error checking active conference:", error);
//     twiml.reject();
//     return res.type('text/xml').send(twiml.toString());
//   }

//   twiml.dial().conference(conferenceRoom, {
//     startConferenceOnEnter: true,
//     endConferenceOnExit: true,
//     maxParticipants: 2,
//     region: 'sg1'
//   });
//   res.type('text/xml').send(twiml.toString());
// });

app.post('/voice-response', async (req, res) => {  
  const twiml = new twilio.twiml.VoiceResponse();
  const caller = req.body.Caller || '';
  
  let conferenceRoom = req.query.room;
  if (!conferenceRoom) {
    conferenceRoom = "ROOM-" + caller.replace(/^client:/, '');
  }

  const expectedCustomer = req.body.ExpectedCustomer;
  const isAgent = caller.startsWith('client:');

  if (isAgent) {
    try {
      const conferences = await twilio_client.conferences.list({
        friendlyName: conferenceRoom,
        status: 'in-progress',
        limit: 1
      });
      
      if (conferences.length > 0) {
        const confSid = conferences[0].sid;
        const participants = await twilio_client.conferences(confSid).participants.list();
        
        let targetFound = false;

        if (expectedCustomer) {
            targetFound = participants.some(p => p.label && p.label.includes(expectedCustomer));
        }

        if (!targetFound) {
           await twilio_client.conferences(confSid).update({ status: 'completed' });
           await new Promise(r => setTimeout(r, 1000)); 
        }
      }
    } catch (e) { console.error(e); }
  } else {
    console.log(`👤 客户进场，直接加入: ${conferenceRoom}`);
  }

  const dial = twiml.dial();
  dial.conference({
    startConferenceOnEnter: true,
    endConferenceOnExit: true,
    maxParticipants: 2,
    region: 'sg1' 
  }, conferenceRoom);

  res.type('text/xml').send(twiml.toString());
});

app.post('/hold-participant', async (req, res) => {
  const conferenceName = req.body.conferenceName;
  try {

    const conferences = await twilio_client.conferences.list({ status: 'in-progress', limit: 100 });
    const matchedConference = conferences.find(conf => conf.friendlyName === conferenceName);
    const participants = await twilio_client.conferences(matchedConference.sid).participants.list({ limit: 20 });

    await Promise.all(participants.map(async (participant) => {
      await twilio_client.conferences(matchedConference.sid)
        .participants(participant.callSid)
        .update({
          hold: true,
          holdUrl: `${BASE_URL}/hold-music`
        });
    }));
    
    res.json({ message: 'Participant is now on hold' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/unhold-participant', async (req, res) => {
  const conferenceName = req.body.conferenceName;
  try {
    const conferences = await twilio_client.conferences.list({ status: 'in-progress', limit: 100 });
    const matchedConference = conferences.find(conf => conf.friendlyName === conferenceName);
    const participants = await twilio_client.conferences(matchedConference.sid).participants.list({ limit: 20 });

    await Promise.all(participants.map(async (participant) => {
      await twilio_client.conferences(matchedConference.sid)
        .participants(participant.callSid)
        .update({
          hold: false
        });
    }));
    
    res.json({ message: 'Participant is now on hold' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/hold-music', (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.play('http://com.twilio.music.soft-rock.s3.amazonaws.com/_ghost_-_promo_2_sample_pack.mp3', { loop: 0 });
  res.type('text/xml').send(twiml.toString());
});

app.post('/cancel-call', async (req, res) => {
  const callSid = req.query.callSID;

  const call = await twilio_client.calls(callSid).fetch()
  const caller = call.from.replace(/^client:/, '')

  await twilio_client.calls(callSid).update({ status: 'canceled' });

  const conferenceRoom = 'ROOM-' + caller

  const conference = await waitForConference(twilio_client, conferenceRoom);
  if (conference) {
    await twilio_client.conferences(conference.sid).update({ status: 'completed' });
  }

  res.status(200).send('Call canceled.');
});

async function waitForConference(client, friendlyName, maxRetries = 5, delayMs = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    const list = await client.conferences.list({
      friendlyName,
      status: 'in-progress'
    });
    if (list.length > 0) return list[0];
    await new Promise(r => setTimeout(r, delayMs));
  }
  return null;
}

app.post("/update-cover-name/:phone", verifyToken, async (req, res) => {
  const { phone } = req.params;
  const { cover_name } = req.body;

  try {
    await client.query("UPDATE phone_numbers SET cover_name = $1 WHERE phone_number = $2", [cover_name, phone]);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Error updating cover name:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// 截取号码设置
app.get('/phone-setting/:phoneNumber', verifyToken, async (req, res) => {

  const phoneNumber = req.params.phoneNumber;
  const result = await client.query('SELECT * FROM phone_settings WHERE phone_number = $1 ORDER BY digit ASC', [phoneNumber]);
  return res.status(200).json(result.rows);
});

// 更新号码设置
app.post('/phone-setting/:phoneNumber', verifyToken, async (req, res) => {
  const phoneNumber = req.params.phoneNumber;
  const { digit, content, redirect_to } = req.body;

  if (!phoneNumber || !digit) {
    return res.status(200).json({ error: "Missing required fields" });
  }

  const existing = await client.query(
    `SELECT 1 FROM phone_settings WHERE phone_number = $1 AND digit = $2`,
    [phoneNumber, digit]
  );

  if (existing.rowCount > 0) {
    // Update if record exists
    await client.query(
      `UPDATE phone_settings SET content = $1, redirect_to = $2 WHERE phone_number = $3 AND digit = $4`,
      [content, redirect_to, phoneNumber, digit]
    );
  } else {
    // Insert if no record exists
    await client.query(
      `INSERT INTO phone_settings (phone_number, digit, content, redirect_to)
       VALUES ($1, $2, $3, $4)`,
      [phoneNumber, digit, content, redirect_to]
    );
  }

  res.status(200).json({ message: "Phone setting saved successfully" });
});

// 截取撥打記錄
app.get('/call-history/:phoneNumber', verifyToken, async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const phoneNumber = req.params.phoneNumber;

  const result = await client.query(
    'SELECT * FROM phone_numbers WHERE user_id = $1 AND phone_number = $2',
    [req.user.userId, phoneNumber]
  );

  if (result.rows.length === 0) {
    return res.status(200).json({
      status: false,
      message: 'Unauthorized: Phone number does not belong to the user.',
    });
  }

  try {
    const now = new Date();
    const startDate = new Date();
    startDate.setDate(now.getDate() - 30);

    const [outboundCalls, inboundCalls] = await Promise.all([
      twilio_client.calls.list({
        to: phoneNumber,
        startTimeAfter: startDate,
        limit: 50,
      }),
      twilio_client.calls.list({
        from: phoneNumber,
        startTimeAfter: startDate,
        limit: 50,
      }),
    ]);

    const allCalls = [...outboundCalls, ...inboundCalls];

    if (allCalls.length === 0) {
      return res.status(200).json({
        status: true,
        message: `No call records found for ${phoneNumber} in the past 30 days.`,
      });
    }

    allCalls.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
    const totalCalls = allCalls.length;
    const totalPages = Math.ceil(totalCalls / limit);
    const paginatedCalls = allCalls.slice((page - 1) * limit, page * limit);

    return res.json({
      status: true,
      message: `Call history for ${phoneNumber} (last 30 days) fetched successfully.`,
      data: paginatedCalls,
      pagination: {
        totalCalls,
        totalPages,
        currentPage: page,
        limit,
      },
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ message: 'Error fetching call history', error: error.message });
  }
});

app.post('/change-password', verifyToken, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const userId = req.user.userId;

  if (!oldPassword || !newPassword) {
    return res.status(200).json({ status: false, message: "All fields are required." });
  }

  try {
      const result = await client.query("SELECT password FROM users WHERE id = $1", [userId]);

      if (result.rows.length === 0) {
        return res.status(200).json({ status: false, message: "User not found." });
      }

      const isValid = await client.query(
        "SELECT * FROM users WHERE id = $1 AND password = crypt($2, password)", 
        [userId, oldPassword]
      );

      if (isValid.rows.length === 0) {
        return res.status(200).json({ status: false, message: "Old password is incorrect." });
      }

      await client.query(
        "UPDATE users SET password = crypt($1, gen_salt('bf')) WHERE id = $2", 
        [newPassword, userId]
      );

      res.status(200).json({ status: true, message: "Password changed successfully." });

  } catch (error) {
      console.error(error);
      res.status(500).json({ status: false, message: "Internal server error." });
  }
});

app.get('/export-call-history/:phoneNumber', async (req, res) => {
  const phoneNumber = req.params.phoneNumber;
  const month = parseInt(req.query.month);
  const year = parseInt(req.query.year);

  if (!month || !year) {
    return res.status(400).json({
      status: false,
      message: 'Please provide both month and year as query parameters.'
    });
  }

  const startTimeAfter = new Date(year, month - 1, 1);
  const startTimeBefore = new Date(year, month, 1);

  try {
    const [
      outboundPlain,
      outboundClient,
      inboundPlain,
      inboundClient
    ] = await Promise.all([
      twilio_client.calls.list({
        to: phoneNumber,
        startTimeAfter: startTimeAfter,
        startTimeBefore: startTimeBefore,
        limit: 1000
      }),
      twilio_client.calls.list({
        to: `client:${phoneNumber}`,
        startTimeAfter: startTimeAfter,
        startTimeBefore: startTimeBefore,
        limit: 1000
      }),
      twilio_client.calls.list({
        from: phoneNumber,
        startTimeAfter: startTimeAfter,
        startTimeBefore: startTimeBefore,
        limit: 1000
      }),
      twilio_client.calls.list({
        from: `client:${phoneNumber}`,
        startTimeAfter: startTimeAfter,
        startTimeBefore: startTimeBefore,
        limit: 1000
      })
    ]);

    const allCalls = [...outboundPlain, ...outboundClient, ...inboundPlain, ...inboundClient];

    allCalls.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

    const mappedCalls = allCalls.map(call => {
      const duration = call.duration ? parseFloat(call.duration) : 0;
      let computedCost = 0;
      if (call.status === "completed") {
        computedCost = 0.08 + (Math.ceil(duration / 60) * 0.08);
      }
      return {
        sid: call.sid,
        status: call.status,
        datetime: call.startTime,
        duration: call.duration,
        direction: call.direction,
        from: call.from,
        to: call.to,
        cost: computedCost
      };
    });

    const fields = ['sid', 'status', 'datetime', 'duration', 'direction', 'from', 'to', 'cost'];
    const json2csvParser = new Parser({ fields });
    const csv = json2csvParser.parse(mappedCalls);
    
    res.header('Content-Type', 'text/csv');
    res.attachment(`call_history_${phoneNumber}.csv`);
    res.send(csv);

    // res.json({
    //   status: true,
    //   message: `Call history for ${phoneNumber} for ${month}/${year} fetched successfully.`,
    //   data: mappedCalls,
    //   totalCost: totalCostFormatted
    // });
  } catch (error) {
    console.error('Error fetching call history:', error);
    res.status(500).json({
      status: false,
      message: 'Error fetching call history',
      error: error.message
    });
  }
});

// 啟動伺服器
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
