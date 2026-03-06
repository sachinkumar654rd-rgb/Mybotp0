const { Telegraf } = require('telegraf');
const axios = require('axios');
const express = require('express');
const { initializeApp, getApps, getApp } = require('firebase/app');
const { getFirestore, doc, setDoc, getDocs, collection, query, getDoc } = require('firebase/firestore');

// --- आपकी जानकारी (Verified) ---
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

const firebaseApp = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(firebaseApp);
const bot = new Telegraf(BOT_TOKEN);

let lastProcessedIssue = "";

// --- 403 Error Fix: ब्राउज़र की तरह दिखने के लिए Headers ---
const fetchGameData = async () => {
    try {
        const response = await axios.get(`${API_URL}?pageSize=50&r=${Math.random()}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Referer': 'https://draw.ar-lottery01.com/',
                'Origin': 'https://draw.ar-lottery01.com'
            },
            timeout: 10000 // 10 सेकंड का वेट
        });
        return response.data.data.list;
    } catch (e) {
        console.error("Fetch Error:", e.message);
        return null;
    }
};

// --- प्रेडिक्शन इंजन ---
async function calculatePrediction(currentNumbers, allHistory) {
    const history = allHistory.map(h => parseInt(h.number));
    for (let L = 10; L >= 3; L--) {
        const pattern = currentNumbers.slice(0, L);
        for (let i = 1; i < history.length - L; i++) {
            let match = true;
            for (let j = 0; j < L; j++) {
                if (history[i + j] !== pattern[j]) { match = false; break; }
            }
            if (match) {
                return { prediction: history[i - 1] >= 5 ? "BIG" : "SMALL", level: `L-${L}` };
            }
        }
    }
    return { prediction: Math.random() > 0.5 ? "BIG" : "SMALL", level: "Analysis" };
}

// --- ऑटो टास्क ---
async function autoTask() {
    try {
        const apiList = await fetchGameData();
        if (!apiList || apiList.length === 0) return;

        const latest = apiList[0];
        
        // डेटा सिंक
        for (let item of apiList) {
            await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'game_history', item.issueNumber), {
                issueNumber: item.issueNumber,
                number: item.number,
                timestamp: Date.now()
            }, { merge: true });
        }

        if (latest.issueNumber === lastProcessedIssue) return;

        // पिछला रिजल्ट चेक
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

        // नया प्रेडिक्शन
        const nextIssue = (BigInt(latest.issueNumber) + 1n).toString();
        const snapshot = await getDocs(collection(db, 'artifacts', appId, 'public', 'data', 'game_history'));
        let allRecords = [];
        snapshot.forEach(d => allRecords.push(d.data()));
        allRecords.sort((a, b) => Number(b.issueNumber) - Number(a.issueNumber));

        const result = await calculatePrediction(apiList.map(h => parseInt(h.number)), allRecords);

        const predMsg = `🎯 *AI PREDICTION*\n━━━━━━━━━━━━━━\n🆔 *Period*: \`#${nextIssue.slice(-4)}\`\n🎲 *Prediction*: *${result.prediction}*\n📊 *Match*: \`${result.level}\`\n⏳ *Result*: Waiting...\n━━━━━━━━━━━━━━`;
        await bot.telegram.sendMessage(CHANNEL_ID, predMsg, { parse_mode: 'Markdown' });

        await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'predictions', nextIssue), {
            issueNumber: nextIssue,
            prediction: result.prediction,
            level: result.level,
            resultSent: false
        });

        lastProcessedIssue = latest.issueNumber;

    } catch (err) {
        console.error("Auto Task Task Fail:", err.message);
    }
}

const app = express();
app.get('/', (req, res) => res.send('AI Bot Status: OK'));
app.listen(process.env.PORT || 3000);

setInterval(autoTask, 40000); // 40 सेकंड का गैप रखें ताकि ब्लॉक न हो
autoTask();

bot.launch();
