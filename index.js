const express = require('express');
const twilio = require('twilio');
require('dotenv').config();

const app = express();

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;
const PORT = process.env.PORT || 3000;

app.use(express.json());

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// 處理來電 Webhook
app.post('/call', express.urlencoded({ extended: false }), (req, res) => {
    const response = new twilio.twiml.VoiceResponse();

    const gather = response.gather({
        numDigits: 1,
        action: '/process-input',
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
    try {
        const { to } = req.body;
        const call = await client.calls.create({
            url: 'https://twilio-api-t328.onrender.com/call',
            to,
            from: TWILIO_PHONE_NUMBER,
        });

        res.json({ message: 'Call initiated', callSid: call.sid });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error initiating call', error: error.message });
    }
});

// 截取撥打記錄
app.get('/call-history', async (req, res) => {
    try {

        const calls = await client.calls.list({
            limit: 1000,
        });

        if (!calls || calls.length === 0) {
            return res.status(404).json({
                message: 'No call records found'
            });
        }

        return res.json({ calls });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ message: 'Error fetching call history', error: error.message });
    }
});

// 啟動伺服器
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
