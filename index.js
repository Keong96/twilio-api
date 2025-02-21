const express = require('express');
const twilio = require('twilio');
const jwt = require("jsonwebtoken");
const bodyParser = require("body-parser");
const { Client } = require('pg');
require('dotenv').config();
const AccessToken = twilio.jwt.AccessToken;
const VoiceGrant = AccessToken.VoiceGrant;
const VoiceResponse = require('twilio').twiml.VoiceResponse;
const app = express();

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_TWIML_APP_SID = process.env.TWILIO_TWIML_APP_SID;
const TWILIO_API_KEY = process.env.TWILIO_API_KEY;
const TWILIO_API_SECRET = process.env.TWILIO_API_SECRET;
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

const twilio_client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

const config = {
  connectionString: process.env.DB
};

const client = new Client(config);
client.connect();

app.get('/', (req, res) => {
  return res.send("OK");
});

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

// WebRTC Token Generation
app.post('/get-token', (req, res) => {
  const identity  = 'caller';

  const voiceGrant = new VoiceGrant({
    outgoingApplicationSid: TWILIO_TWIML_APP_SID,
  });

  const token = new AccessToken(TWILIO_ACCOUNT_SID, TWILIO_API_KEY, TWILIO_API_SECRET, {identity});
  token.addGrant(voiceGrant);

  res.json({ token: token.toJwt() });
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// 登录
app.post('/login', async (req, res) => {
  if (typeof(req.body.email) === 'undefined' || typeof(req.body.password) === 'undefined') {
    return res.status(200).json({
      status: false,
      data: {},
      message: "Error: Please enter your email and password to login.",
    });
  }

  client.query("SELECT * FROM users WHERE email = $1 AND password = crypt($2, password)", [req.body.email, req.body.password])
    .then((result) => {
      if (result.rows.length > 0) {
        const token = GenerateJWT(result.rows[0].id, result.rows[0].email);
       
        res.status(200).json({
          status: true,
          data: {
            userId: result.rows[0].id,
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
  const result = await client.query('SELECT phone_number FROM phone_numbers WHERE user_id = $1', [req.user.userId]);
  const phoneNumbers = result.rows.map(row => row.phone_number);
  return res.status(200).json(phoneNumbers);
});

app.get("/get-cover-name/:phoneNumber", verifyToken, async (req, res) => {
  const { phoneNumber } = req.params;
  try {
    const result = await client.query("SELECT cover_name FROM phone_numbers WHERE phone_number = $1", [phoneNumber]);
    return res.status(200).send(result.rows[0].cover_name);
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
        ivrMenuText = `欢迎致电 ${cover_name}`;
      else
        ivrMenuText = '欢迎致电，';

      ivrSettings.forEach(setting => {
        ivrMenuText += `按 ${setting.digit}，${setting.content}，`;
      });
    } else if (selectedLanguage === 'en') {

      if(cover_name)
        ivrMenuText = `Welcome to ${cover_name}`;
      else
        ivrMenuText = 'Welcome, ';

      ivrSettings.forEach(setting => {
        ivrMenuText += `${setting.content}, please press ${setting.digit}.`;
      });
    } else if (selectedLanguage === 'ms') {

      if(cover_name)
        ivrMenuText = `Selamat datang ke ${cover_name}`;
      else
        ivrMenuText = 'Selamat datang, ';

      ivrSettings.forEach(setting => {
        ivrMenuText += `Tekan ${setting.digit} untuk ${setting.content}, `;
      });
    }

    const gather = response.gather({
      numDigits: 1,
      action: 'https://twilio-api-t328.onrender.com/process-input',
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

      if (result.rows[0].cover_number) {
        dialOptions.callerId = phoneNumber;
      }

      response.dial(dialOptions, settings.redirect_to);
      
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
        action: 'https://twilio-api-t328.onrender.com/process-input',
        method: 'POST'
      });
    }

    res.type('text/xml');
    res.send(response.toString());
});

// 測試撥打電話
app.post('/make-call', async (req, res) => {
  const phoneNumber = req.body.phoneNumber;
  const to = req.body.to;

  try {
    const call = await twilio_client.calls.create({
      url: `https://twilio-api-t328.onrender.com/voice-response`,
      to: to,
      from: phoneNumber,
    });

    res.json({ message: 'Call initiated', callSid: call.sid });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error initiating call', error: error.message });
  }
});

app.post('/voice-response', (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();

  // When the recipient answers, they are joined to the conference.
  twiml.dial().conference('MyConferenceRoom', {
    startConferenceOnEnter: true,
    endConferenceOnExit: true
  });
  res.type('text/xml').send(twiml.toString());
});

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

  if (!phoneNumber || !digit || !content || !redirect_to) {
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
  const result = await client.query('SELECT * FROM phone_numbers WHERE user_id = $1 AND phone_number = $2', [req.user.userId, phoneNumber]);
    
  if (result.rows.length === 0) {
    return res.status(200).json({
      status: false,
      message: 'Unauthorized: Phone number does not belong to the user.',
    });
  }

  try {
    const [outboundCalls, inboundCalls] = await Promise.all([
      twilio_client.calls.list({
        to: phoneNumber,
      }),
      twilio_client.calls.list({
        from: phoneNumber,
      }),
    ]);

    const allCalls = [...outboundCalls, ...inboundCalls];

    if (allCalls.length === 0) {
      return res.status(200).json({
        status: true,
        message: `No call records found for ${phoneNumber} in the specified period.`,
      });
    }

    allCalls.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
    const totalCalls = allCalls.length;
    const totalPages = Math.ceil(totalCalls / limit);
    const paginatedCalls = allCalls.slice((page - 1) * limit, page * limit);

    return res.json({
      status: true,
      message: `Call history for ${phoneNumber} fetched successfully.`,
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

// 啟動伺服器
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
