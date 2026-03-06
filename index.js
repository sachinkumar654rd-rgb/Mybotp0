const { Telegraf } = require('telegraf');
const axios = require('axios');
const express = require('express');
const { initializeApp, getApps, getApp } = require('firebase/app');
const { 
    getFirestore, doc, setDoc, getDocs, 
    collection, query, limit, orderBy, getDoc 
} = require('firebase/firestore');

// --- कॉन्फ़िगरेशन ---
const BOT_TOKEN = '8274061406:AAEOYKlpE3jbW6P588tM9brp325x20CnBms';
const CHANNEL_ID = '-1002341235401'; // आपकी चैनल आईडी (सुनिश्चित करें कि बोट एडमिन हो)
const API_URL = "https://draw.ar-lottery01.com/WinGo/WinGo_1M/GetHistoryIssuePage.json";
const APP_ID = "ai-bot-pro-v1";

const firebaseConfig = {
    apiKey: "AIzaSyA-BRHGn5qxdvfz396454dnW5BErjEwEMQ",
    authDomain: "mybotp0.firebaseapp.com",
    projectId: "mybotp0",
    storageBucket: "mybotp0.firebasestorage.app",
    messagingSenderId: "674653087526",
    appId: "1:674653087526:web:6bf91e3a65e146063043e7",
    measurementId: "G-0MJWZJ6C4M"
};

// --- इनिशियलाइजेशन ---
const firebaseApp = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(firebaseApp);
const bot = new Telegraf(BOT_TOKEN);

// --- हेल्पर फंक्शन्स ---

// डेटा सिंक और सेव करने के लिए
async function syncGameData() {
    try {
        const response = await axios.get(`${API_URL}?pageSize=50&r=${Math.random()}`);
        const apiList = response.data.data.list;
        
        for (let item of apiList) {
            const docRef = doc(db, 'artifacts', APP_ID, 'public', 'data', 'game_history', item.issueNumber);
            await setDoc(docRef, {
                issueNumber: item.issueNumber,
                number: parseInt(item.number),
                color: item.colour,
                premium: item.premium,
                timestamp: Date.now()
            }, { merge: true });
        }
        return apiList;
    } catch (e) {
        console.error("Sync Error:", e.message);
        return null;
    }
}

// प्रेडिक्शन लॉजिक (पैटर्न मैचिंग L10 to L3)
async function getAIPrediction(currentSeq) {
    const historyRef = collection(db, 'artifacts', APP_ID, 'public', 'data', 'game_history');
    const snapshot = await getDocs(query(historyRef));
    let allRecords = [];
    snapshot.forEach(doc => allRecords.push(doc.data()));
    allRecords.sort((a, b) => Number(b.issueNumber) - Number(a.issueNumber));

    const historyNums = allRecords.map(h => h.number);
    
    for (let L = 10; L >= 3; L--) {
        const pattern = currentSeq.slice(0, L);
        for (let i = 1; i < historyNums.length - L; i++) {
            let match = true;
            for (let j = 0; j < L; j++) {
                if (historyNums[i + j] !== pattern[j]) {
                    match = false;
                    break;
                }
            }
            if (match) {
                const predNum = historyNums[i - 1];
                return {
                    prediction: predNum >= 5 ? "BIG" : "SMALL",
                    level: L,
                    foundInDB: allRecords.length
                };
            }
        }
    }
    return { prediction: Math.random() > 0.5 ? "BIG" : "SMALL", level: "Random/AI", foundInDB: allRecords.length };
}

// चैनल में ऑटो प्रेडिक्शन और रिजल्ट अपडेट
let lastProcessedIssue = "";

async function runAutoBot() {
    const apiData = await syncGameData();
    if (!apiData) return;

    const latest = apiData[0];
    const currentIssue = latest.issueNumber;
    const nextIssue = (BigInt(currentIssue) + 1n).toString();

    // 1. रिजल्ट चेक और पिछले मैसेज को अपडेट करना
    const lastPredDoc = doc(db, 'artifacts', APP_ID, 'public', 'data', 'last_prediction', 'current');
    const lastPredSnap = await getDoc(lastPredDoc);

    if (lastPredSnap.exists()) {
        const lastPredData = lastPredSnap.data();
        if (lastPredData.issueNumber === currentIssue && !lastPredData.isUpdated) {
            const actualResult = parseInt(latest.number) >= 5 ? "BIG" : "SMALL";
            const isWin = lastPredData.prediction === actualResult;
            const statusEmoji = isWin ? "✅ WIN" : "❌ LOSS";

            const updateText = `🆔 *Period:* \`#${currentIssue.slice(-4)}\`\n🎲 *Prediction:* ${lastPredData.prediction}\n🎯 *Result:* ${actualResult} (${latest.number})\n📊 *Status:* ${statusEmoji}\n✨ *Level:* L-${lastPredData.level}`;
            
            try {
                await bot.telegram.editMessageText(CHANNEL_ID, lastPredData.messageId, null, updateText, { parse_mode: 'Markdown' });
                await setDoc(lastPredDoc, { isUpdated: true }, { merge: true });
            } catch (err) { console.log("Edit error or message not found"); }
        }
    }

    // 2. नया प्रेडिक्शन भेजना
    if (lastProcessedIssue !== currentIssue) {
        lastProcessedIssue = currentIssue;
        const currentSeq = apiData.slice(0, 10).map(item => parseInt(item.number));
        const ai = await getAIPrediction(currentSeq);

        const predText = `🎯 *AI PREDICTION*\n━━━━━━━━━━━━━━\n🆔 *Period:* \`#${nextIssue.slice(-4)}\`\n🎲 *Prediction:* **${ai.prediction}**\n📊 *Match:* Level-${ai.level}\n⏳ *Result:* Waiting...\n━━━━━━━━━━━━━━\n@YourChannelUsername`;

        const sentMsg = await bot.telegram.sendMessage(CHANNEL_ID, predText, { parse_mode: 'Markdown' });

        await setDoc(lastPredDoc, {
            issueNumber: nextIssue,
            prediction: ai.prediction,
            level: ai.level,
            messageId: sentMsg.message_id,
            isUpdated: false,
            timestamp: Date.now()
        });
    }
}

// --- कमांड्स ---

bot.start((ctx) => ctx.reply("नमस्ते! मैं आपका AI Prediction बोट हूँ। /prediction और /history का उपयोग करें।"));

bot.command('prediction', async (ctx) => {
    ctx.reply("🔍 AI डेटा स्कैन कर रहा है...");
    const apiData = await syncGameData();
    if (!apiData) return ctx.reply("API Error!");
    
    const latest = apiData[0];
    const nextIssue = (BigInt(latest.issueNumber) + 1n).toString();
    const currentSeq = apiData.slice(0, 10).map(h => parseInt(h.number));
    
    const ai = await getAIPrediction(currentSeq);
    
    ctx.replyWithMarkdown(`🎯 *MANUAL PREDICTION*\n━━━━━━━━━━━━━━\n🆔 Period: \`#${nextIssue.slice(-4)}\`\n🎲 Prediction: *${ai.prediction}*\n📊 Accuracy: \`L-${ai.level}\`\n🗂️ DB Size: \`${ai.foundInDB}\``);
});

bot.command('history', async (ctx) => {
    const historyRef = collection(db, 'artifacts', APP_ID, 'public', 'data', 'game_history');
    const snapshot = await getDocs(query(historyRef, limit(20)));
    let msg = "📊 *LATEST HISTORY*\n━━━━━━━━━━━━━━\n";
    
    let records = [];
    snapshot.forEach(doc => records.push(doc.data()));
    records.sort((a, b) => Number(b.issueNumber) - Number(a.issueNumber));

    records.forEach(r => {
        const size = r.number >= 5 ? "BIG" : "SMALL";
        msg += `\`#${r.issueNumber.slice(-4)}\`: ${r.number} (${size})\n`;
    });
    ctx.replyWithMarkdown(msg);
});

// --- सर्वर सेटअप ---
const app = express();
app.get('/', (req, res) => res.send('Bot is Running & Syncing...'));
app.listen(process.env.PORT || 3000);

// ऑटोमेशन शुरू करें
setInterval(runAutoBot, 30000); // हर 30 सेकंड में चेक करें
runAutoBot();

bot.launch().then(() => console.log("Bot Started Successfully!"));
