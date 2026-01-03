// usageLimit.js
// 役割: Firebaseと通信して、1日の使用回数を管理・制限する

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc }
    from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ========================================================
// ★ここにFirebaseの設定を貼り付けてください
// ========================================================
const firebaseConfig = {
    apiKey: "AIzaSyBY9aJQSP5OgS2GB6Ork4WkxHQevpKOB9E",
    authDomain: "map-tool-f52a8.firebaseapp.com",
    projectId: "map-tool-f52a8",
    storageBucket: "map-tool-f52a8.firebasestorage.app",
    messagingSenderId: "672494892476",
    appId: "1:672494892476:web:59c7296abdb5481c5f27b9",
    measurementId: "G-TQZRY26130"
};

// Firebase初期化
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// 制限設定 (1日300回)
const LIMITS = {
    DAILY: 300
};

// 状態管理用変数
let myUserId = localStorage.getItem('coord_tool_user_id');

// DOM要素（index.html内の要素と紐付けます）
let displayElement = null;

/**
 * 初期化処理: ユーザー登録と残り回数の表示
 * @param {HTMLElement} element - 残り回数を表示するHTML要素
 */
export async function initUsageLimit(element) {
    displayElement = element;

    // ユーザーIDがない場合は新規作成
    if (!myUserId) {
        myUserId = crypto.randomUUID();
        localStorage.setItem('coord_tool_user_id', myUserId);

        // Firestoreに新規登録
        await setDoc(doc(db, "users", myUserId), {
            createdAt: new Date().toISOString(),
            daily_count: 0,
            lastDate: ""
        });
        console.log("新規ユーザー登録:", myUserId);
    }

    // 初回の表示更新
    await updateDisplay();
}

/**
 * API使用権限のチェックとカウント消費
 * @returns {Promise<boolean>} 使用OKならtrue, NGならfalse
 */
export async function checkAndConsumeQuota() {
    const userRef = doc(db, "users", myUserId);
    const snap = await getDoc(userRef);

    if (!snap.exists()) {
        // データがない場合の復旧（念のため）
        await initUsageLimit(displayElement);
        return checkAndConsumeQuota();
    }

    const data = snap.data();
    const now = new Date();
    const currentDate = now.toISOString().slice(0, 10); // "2026-01-04"

    let updates = {};
    let dailyCount = data.daily_count;

    // 日付が変わっていたらリセット
    if (data.lastDate !== currentDate) {
        updates.lastDate = currentDate;
        updates.daily_count = 0;
        dailyCount = 0;
    } else {
        // リセット不要なら、更新用オブジェクトに現在の日付を入れておく
        updates.lastDate = currentDate;
    }

    // 上限チェック
    if (dailyCount >= LIMITS.DAILY) {
        alert(`本日の検索上限（${LIMITS.DAILY}回）に達しました。\n明日またご利用ください。`);
        updateDisplay(0); // 表示を0に強制更新
        return false;
    }

    // カウントアップして保存
    updates.daily_count = dailyCount + 1;
    await updateDoc(userRef, updates);

    // 表示更新
    updateDisplay(LIMITS.DAILY - (dailyCount + 1));

    return true;
}

/**
 * 画面の残り回数を更新する内部関数
 */
async function updateDisplay(forceValue = null) {
    if (!displayElement) return;

    if (forceValue !== null) {
        displayElement.textContent = `あと ${forceValue} 回`;
        return;
    }

    // 最新データを取得して表示
    try {
        const snap = await getDoc(doc(db, "users", myUserId));
        if (snap.exists()) {
            const data = snap.data();
            const currentDate = new Date().toISOString().slice(0, 10);

            // 日付が今日なら計算、古ければ満タン表示
            let remaining = LIMITS.DAILY;
            if (data.lastDate === currentDate) {
                remaining = LIMITS.DAILY - data.daily_count;
            }

            displayElement.textContent = `あと ${remaining} 回`;
        }
    } catch (e) {
        console.error("表示更新エラー:", e);
        displayElement.textContent = "---";
    }
}