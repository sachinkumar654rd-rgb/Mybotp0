const { Telegraf } = require('telegraf');
const axios = require('axios');
const express = require('express');
const { initializeApp, getApps, getApp } = require('firebase/app');
const { getFirestore, doc, setDoc, getDocs, collection, query, getDoc } = require('firebase/firestore');

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
  appId: "1:674653087526:web:ad90ae905954b8bc3043e7",
  measurementId: "G-0DQYTGPH05"
};

// --- इनिशियलाइजेशन ---
const firebaseApp = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(firebaseApp);
const bot = new Telegraf(BOT_TOKEN);

let lastProcessedIssue = "";

// --- प्रेडिक्शन इंजन (L10 to L3) ---
async function calculatePrediction(currentNumbers, allHistory) {
    const history = allHistory.map(h => parseInt(h.number));
    
    for (let L = 10; L >= 3; L--) {
        const pattern = currentNumbers.slice(0, L);
        for (let i = 1; i < history.length - L; i++) {
            let match = true;
            for (let j = 0; j < L; j++) {
                if (history[i + j] !== pattern[j]) {
                    match = false;
                    break;
                }
            }
            if (match) {
                const nextNum = history[i - 1];
                return { 
                    prediction: nextNum >= 5 ? "BIG" : "SMALL", 
                    level: `L-${L}` 
                };
            }
        }
    }
    // अगर कोई मैच न मिले तो रैंडम (या आप इसे "Wait" रख सकते हैं)
    return { prediction: Math.random() > 0.5 ? "BIG" : "SMALL", level: "Analysis" };
}

// --- मुख्य ऑटोमेशन फंक्शन ---
async function autoTask() {
    try {
        const response = await axios.get(`${API_URL}?pageSize=50&r=${Math.random()}`);
        const apiList = response.data.data.list;
        if (!apiList || apiList.length === 0) return;

        const latest = apiList[0];
        
        // 1. डेटाबेस में नया डेटा सिंक करें
        for (let item of apiList) {
            await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'game_history', item.issueNumber), {
                issueNumber: item.issueNumber,
                number: item.number,
                timestamp: Date.now()
            }, { merge: true });
        }

        if (latest.issueNumber === lastProcessedIssue) return;

        // 2. पिछले प्रेडिक्शन का रिजल्ट चेक करें (Win/Loss)
        const prevIssueNum = (BigInt(latest.issueNumber)).toString();
        const prevPredDoc = doc(db, 'artifacts', appId, 'public', 'data', 'predictions', prevIssueNum);
        const prevSnap = await getDoc(prevPredDoc);

        if (prevSnap.exists() && !prevSnap.data().resultSent) {
            const predData = prevSnap.data();
            const actualSize = parseInt(latest.number) >= 5 ? "BIG" : "SMALL";
            const isWin = predData.prediction === actualSize;
            
            const resultMsg = `━━━━━━━━━━━━━━\n🆔 *Period*: \`#${latest.issueNumber.slice(-4)}\`\n🎲 *Result*: ${latest.number} (${actualSize})\n📊 *Status*: ${isWin ? "WIN (✔)" : "LOSS (✘)"}\n━━━━━━━━━━━━━━`;
            await bot.telegram.sendMessage(CHANNEL_ID, resultMsg, { parse_mode: 'Markdown' });
            await setDoc(prevPredDoc, { resultSent: true, win: isWin }, { merge: true });
        }

        // 3. नया प्रेडिक्शन तैयार करें
        const nextIssue = (BigInt(latest.issueNumber) + 1n).toString();
        
        // डेटाबेस से पूरी हिस्ट्री लोड करें
        const snapshot = await getDocs(collection(db, 'artifacts', appId, 'public', 'data', 'game_history'));
        let allRecords = [];
        snapshot.forEach(d => allRecords.push(d.data()));
        allRecords.sort((a, b) => Number(b.issueNumber) - Number(a.issueNumber));

        const currentSeq = apiList.map(h => parseInt(h.number));
        const result = await calculatePrediction(currentSeq, allRecords);

        // 4. चैनल में प्रेडिक्शन भेजें
        const predMsg = `🎯 *AI PREDICTION*\n━━━━━━━━━━━━━━\n🆔 *Period*: \`#${nextIssue.slice(-4)}\`\n🎲 *Prediction*: *${result.prediction}*\n📊 *Match*: \`${result.level}\`\n⏳ *Result*: Waiting...\n━━━━━━━━━━━━━━`;
        await bot.telegram.sendMessage(CHANNEL_ID, predMsg, { parse_mode: 'Markdown' });

        // प्रेडिक्शन को सेव करें
        await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'predictions', nextIssue), {
            issueNumber: nextIssue,
            prediction: result.prediction,
            level: result.level,
            resultSent: false
        });

        lastProcessedIssue = latest.issueNumber;

    } catch (err) {
        console.error("Auto Task Error:", err.message);
    }
}

// --- कमांड्स ---
bot.command('history', async (ctx) => {
    try {
        const snapshot = await getDocs(collection(db, 'artifacts', appId, 'public', 'data', 'game_history'));
        let records = [];
        snapshot.forEach(d => records.push(d.data()));
        records.sort((a, b) => Number(b.issueNumber) - Number(a.issueNumber));

        let msg = "📊 *LATEST HISTORY*\n━━━━━━━━━━━━━━\n*PR* | *Period* | *Result*\n";
        records.slice(0, 20).forEach((r, i) => {
            const size = parseInt(r.number) >= 5 ? "B" : "S";
            msg += `\`${(i + 1).toString().padStart(4, '0')}\` | \`#${r.issueNumber.slice(-4)}\` | ${r.number} (${size})\n`;
        });
        msg += `━━━━━━━━━━━━━━\nTotal DB: \`${records.length}\``;
        ctx.replyWithMarkdown(msg);
    } catch (e) {
        ctx.reply("Error fetching history.");
    }
});

// --- सर्वर सेटअप ---
const app = express();
app.get('/', (req, res) => res.send('AI Prediction Bot is Running...'));
app.listen(process.env.PORT || 3000);

// हर 30 सेकंड में लूप चलाएं
setInterval(autoTask, 30000);
autoTask();

bot.launch().then(() => console.log("Bot started on Telegram!"));
