const express = require('express');
const twilio = require('twilio');
require('dotenv').config();

const app = express();

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

app.get('/', (req, res) => {
  return res.send("OK");
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// 登录
app.post('/login', (req, res) => {
    const { username, password } = req.body;

    if (username === adminCredentials.username && password === adminCredentials.password) {
        return res.status(200).json({ success: true });
    } else {
        return res.status(401).json({ success: false, error: 'Invalid username or password' });
    }
});

app.get('/phone-numbers', (req, res) => {
  const phoneNumbers = process.env.TWILIO_PHONE_NUMBERS.split(',');
  return res.status(200).json(phoneNumbers);
});

// 處理來電 Webhook
app.post('/call', express.urlencoded({ extended: false }), (req, res) => {
    const response = new twilio.twiml.VoiceResponse();

    const gather = response.gather({
        numDigits: 1,
        action: 'https://twilio-api-t328.onrender.com/process-input',
        method: 'POST',
    });

    gather.say('歡迎致電，請按 1 聯繫客服，按 2 聯繫技術支持，按 3 查詢其他服務。');

    response.say('感謝您的來電，再見。');
    response.hangup();

    res.type('text/xml');
    res.send(response.toString());
});

// 處理用戶輸入
app.post('/process-input', express.urlencoded({ extended: false }), (req, res) => {
    const response = new twilio.twiml.VoiceResponse();
    const userInput = req.body.Digits;

    switch (userInput) {
        case '1':
            response.dial('+1234567890');
            break;
        case '2':
            response.dial('+0987654321');
            break;
        case '3':
            response.say('感謝您查詢，請稍後再聯絡我們。');
            response.hangup();
            break;
        default:
            response.say('無效的選擇，請重試。');
            response.redirect('/call');
            break;
    }

    res.type('text/xml');
    res.send(response.toString());
});

// 測試撥打電話
app.post('/make-call', express.json(), async (req, res) => {
    const phoneNumber = req.body.phoneNumber;
    const to = req.body.to;
    
    try {
        const call = await client.calls.create({
            url: 'https://twilio-api-t328.onrender.com/call',
            to,
            from: phoneNumber,
        });

        res.json({ message: 'Call initiated', callSid: call.sid });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error initiating call', error: error.message });
    }
});

// 截取撥打記錄
app.get('/call-history/:phoneNumber', async (req, res) => {
  const phoneNumber = req.params.phoneNumber;
    try {
        const [outboundCalls, inboundCalls] = await Promise.all([
            client.calls.list({
                to: phoneNumber,
            }),
            client.calls.list({
                from: phoneNumber,
            }),
        ]);

        const allCalls = [...outboundCalls, ...inboundCalls];

        if (allCalls.length === 0) {
            return res.status(404).json({
                message: `No call records found for ${phoneNumber} in the specified period.`,
            });
        }

        return res.json({
            message: `Call history for ${phoneNumber} fetched successfully.`,
            data: allCalls,
        });

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ message: 'Error fetching call history', error: error.message });
    }
});

// 啟動伺服器
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
