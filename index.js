const { Telegraf } = require('telegraf');
const axios = require('axios');
const express = require('express');
const { initializeApp, getApps, getApp } = require('firebase/app');
const { 
    getFirestore, doc, setDoc, getDocs, 
    collection, query, limit, getDoc 
} = require('firebase/firestore');

// --- कॉन्फ़िगरेशन ---
const BOT_TOKEN = '8274061406:AAEOYKlpE3jbW6P588tM9brp325x20CnBms';
const CHANNEL_ID = '-1003741235401'; 
const API_URL = "https://draw.ar-lottery01.com/WinGo/WinGo_1M/GetHistoryIssuePage.json";
const APP_ID = "ai-bot-final-v1";

const firebaseConfig = {
  apiKey: "AIzaSyA-BRHGn5qxdvfz396454dnW5BErjEwEMQ",
  authDomain: "mybotp0.firebaseapp.com",
  projectId: "mybotp0",
  storageBucket: "mybotp0.firebasestorage.app",
  messagingSenderId: "674653087526",
  appId: "1:674653087526:web:6bf91e3a65e146063043e7",
  measurementId: "G-0MJWZJ6C4M"
};

const firebaseApp = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(firebaseApp);
const bot = new Telegraf(BOT_TOKEN);

// बेहतर API कॉल के लिए हेडर्स
const axiosConfig = {
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'application/json',
        'Referer': 'https://draw.ar-lottery01.com/'
    }
};

async function syncData() {
    try {
        const res = await axios.get(`${API_URL}?pageSize=50&_t=${Date.now()}`, axiosConfig);
        if (res.data && res.data.data && res.data.data.list) {
            const list = res.data.data.list;
            for (let item of list) {
                const docRef = doc(db, 'artifacts', APP_ID, 'public', 'data', 'history', item.issueNumber);
                await setDoc(docRef, {
                    issueNumber: item.issueNumber,
                    number: parseInt(item.number),
                    timestamp: Date.now()
                }, { merge: true });
            }
            return list;
        }
        return null;
    } catch (err) {
        console.error("API Error Detail:", err.message);
        return null;
    }
}

async function calculateAIPrediction(currentSequence) {
    const colRef = collection(db, 'artifacts', APP_ID, 'public', 'data', 'history');
    const snapshot = await getDocs(query(colRef));
    let history = [];
    snapshot.forEach(d => history.push(d.data()));
    
    if (history.length < 5) return { result: "WAIT", level: "Low Data", totalScanned: history.length };

    history.sort((a, b) => Number(b.issueNumber) - Number(a.issueNumber));
    const historyNums = history.map(h => h.number);

    for (let L = 10; L >= 3; L--) {
        const pattern = currentSequence.slice(0, L);
        for (let i = 1; i < historyNums.length - L; i++) {
            let isMatch = true;
            for (let j = 0; j < L; j++) {
                if (historyNums[i + j] !== pattern[j]) {
                    isMatch = false;
                    break;
                }
            }
            if (isMatch) {
                const nextVal = historyNums[i - 1];
                return { 
                    result: nextVal >= 5 ? "BIG" : "SMALL", 
                    level: L, 
                    totalScanned: history.length 
                };
            }
        }
    }
    return { result: Math.random() > 0.5 ? "BIG" : "SMALL", level: "AI-Gen", totalScanned: history.length };
}

let lastActiveIssue = "";

async function processAutomation() {
    const list = await syncData();
    if (!list) return;

    const latest = list[0];
    const currentIssue = latest.issueNumber;
    const nextIssue = (BigInt(currentIssue) + 1n).toString();

    // 1. Result Update
    const lastDocRef = doc(db, 'artifacts', APP_ID, 'public', 'data', 'last_pred', 'state');
    const lastSnap = await getDoc(lastDocRef);

    if (lastSnap.exists()) {
        const data = lastSnap.data();
        if (data.issueNumber === currentIssue && !data.completed) {
            const actualSize = parseInt(latest.number) >= 5 ? "BIG" : "SMALL";
            const win = data.prediction === actualSize;
            const emoji = win ? "✅ WIN" : "❌ LOSS";

            const resultText = `🆔 *Period:* \`#${currentIssue.slice(-4)}\`\n🎲 *Prediction:* ${data.prediction}\n🎯 *Result:* ${actualSize} (${latest.number})\n📊 *Status:* ${emoji}\n✨ *Matched:* Level-${data.level}`;
            
            try {
                await bot.telegram.editMessageText(CHANNEL_ID, data.msgId, null, resultText, { parse_mode: 'Markdown' });
                await setDoc(lastDocRef, { completed: true }, { merge: true });
            } catch (e) {}
        }
    }

    // 2. New Prediction
    if (lastActiveIssue !== currentIssue) {
        lastActiveIssue = currentIssue;
        const seq = list.slice(0, 10).map(x => parseInt(x.number));
        const ai = await calculateAIPrediction(seq);

        const msgText = `🎯 *AI PREDICTION*\n━━━━━━━━━━━━━━\n🆔 *Period:* \`#${nextIssue.slice(-4)}\`\n🎲 *Prediction:* **${ai.result}**\n📊 *Match:* Level-${ai.level}\n⏳ *Result:* Wait...\n━━━━━━━━━━━━━━\nTotal Scanned: \`${ai.totalScanned}\``;

        try {
            const sent = await bot.telegram.sendMessage(CHANNEL_ID, msgText, { parse_mode: 'Markdown' });
            await setDoc(lastDocRef, {
                issueNumber: nextIssue,
                prediction: ai.result,
                level: ai.level,
                msgId: sent.message_id,
                completed: false
            });
        } catch (e) {}
    }
}

bot.start((ctx) => ctx.reply("बोट सक्रिय है! /prediction कमांड भेजें।"));

bot.command('prediction', async (ctx) => {
    ctx.reply("🔍 डेटा स्कैन किया जा रहा है, कृपया प्रतीक्षा करें...");
    const list = await syncData();
    if (!list) return ctx.reply("❌ API Error! कृपया 1 मिनट बाद प्रयास करें।");
    
    const seq = list.slice(0, 10).map(x => parseInt(x.number));
    const ai = await calculateAIPrediction(seq);
    ctx.replyWithMarkdown(`🎯 *AI Manual Scan*\nNext: \`#${(BigInt(list[0].issueNumber)+1n).toString().slice(-4)}\`\nPredict: *${ai.result}*\nMatch: L-${ai.level}`);
});

bot.command('history', async (ctx) => {
    try {
        const snap = await getDocs(query(collection(db, 'artifacts', APP_ID, 'public', 'data', 'history'), limit(15)));
        let rows = [];
        snap.forEach(d => rows.push(d.data()));
        
        if (rows.length === 0) return ctx.reply("❌ अभी डेटाबेस खाली है। बोट डेटा सिंक कर रहा है...");

        let text = "📊 *Recent History*\n━━━━━━━━━━━━━━\n";
        rows.sort((a,b) => Number(b.issueNumber) - Number(a.issueNumber)).forEach(r => {
            text += `\`#${r.issueNumber.slice(-4)}\`: ${r.number} (${r.number >= 5 ? 'BIG' : 'SMALL'})\n`;
        });
        ctx.replyWithMarkdown(text);
    } catch(e) { ctx.reply("Error fetching history."); }
});

const app = express();
app.get('/', (req, res) => res.send('Bot Active'));
app.listen(process.env.PORT || 3000);

setInterval(processAutomation, 20000); // 20 सेकंड में ऑटो सिंक
processAutomation();
bot.launch();
