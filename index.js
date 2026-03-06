const { Telegraf } = require('telegraf');
const axios = require('axios');
const { initializeApp, getApps, getApp } = require('firebase/app');
const { getFirestore, doc, setDoc, getDocs, collection } = require('firebase/firestore');
const express = require('express');

// --- आपकी जानकारी ---
const BOT_TOKEN = '8716381451:AAE77huBDXVdeC_nU0quIxMtxQj0NDqazAM';
const CHANNEL_ID = '-1003741235401';
const API_URL = "https://draw.ar-lottery01.com/WinGo/WinGo_1M/GetHistoryIssuePage.json";
const appId = "mybotp0-ai-v1";

const firebaseConfig = {
    apiKey: "AIzaSyA-BRHGn5qxdvfz396454dnW5BErjEwEMQ",
    authDomain: "mybotp0.firebaseapp.com",
    projectId: "mybotp0",
    storageBucket: "mybotp0.firebasestorage.app",
    messagingSenderId: "674653087526",
    appId: "1:674653087526:web:ad90ae905954b8bc3043e7"
};

// इनिशियलाइजेशन
const firebaseApp = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(firebaseApp);
const bot = new Telegraf(BOT_TOKEN);

let lastProcessedIssue = "";

// डेटा फ़ेच फंक्शन (403 बाईपास के साथ)
async function fetchGameData() {
    try {
        const res = await axios.get(`${API_URL}?pageSize=10&r=${Math.random()}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://draw.ar-lottery01.com/'
            }
        });
        return res.data.data.list;
    } catch (e) {
        console.error("Fetch Error:", e.message);
        return null;
    }
}

// मेन ऑटोमेशन टास्क
async function mainTask() {
    const list = await fetchGameData();
    if (!list || list.length === 0) return;

    const latest = list[0];
    if (latest.issueNumber === lastProcessedIssue) return;

    // डेटा सिंक (Firebase)
    try {
        await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'game_history', latest.issueNumber), {
            issueNumber: latest.issueNumber,
            number: latest.number,
            timestamp: Date.now()
        }, { merge: true });
    } catch (e) { console.error("Firebase Sync Error"); }

    // प्रेडिक्शन लॉजिक
    const nextIssue = (BigInt(latest.issueNumber) + 1n).toString();
    const prediction = Math.random() > 0.5 ? "🔴 BIG" : "🟢 SMALL";

    const msg = `🎯 *AI PREDICTION*\n━━━━━━━━━━━━━━\n🆔 Period: \`#${nextIssue.slice(-4)}\` \n🎲 Prediction: *${prediction}*\n📊 Status: Waiting...\n━━━━━━━━━━━━━━`;
    
    try {
        await bot.telegram.sendMessage(CHANNEL_ID, msg, { parse_mode: 'Markdown' });
    } catch (e) { console.error("Telegram Send Error"); }

    lastProcessedIssue = latest.issueNumber;
}

// कमांड्स
bot.command('start', (ctx) => ctx.reply("बॉट GitHub पर सक्रिय है!"));
bot.command('history', async (ctx) => {
    const snap = await getDocs(collection(db, 'artifacts', appId, 'public', 'data', 'game_history'));
    let recs = [];
    snap.forEach(d => recs.push(d.data()));
    recs.sort((a, b) => Number(b.issueNumber) - Number(a.issueNumber));
    let m = "📊 *History*\n" + recs.slice(0, 10).map(r => `#${r.issueNumber.slice(-4)}: ${r.number}`).join('\n');
    ctx.replyWithMarkdown(m || "No Data");
});

// लूप और सर्वर
setInterval(mainTask, 50000);
mainTask();

bot.launch();

// Render/Koyeb के लिए पोर्ट
const app = express();
app.get('/', (req, res) => res.send('Bot is Alive!'));
app.listen(process.env.PORT || 3000);
