const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs/promises');
const path = require('path');
const axios = require('axios');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const multer = require('multer');

const transporter = nodemailer.createTransport({
    host: 'smtp.zoho.com',
    port: 465,
    secure: true,
    auth: {
        user: 'no-reply@coinwit.net',
        pass: 'kDmHnHmn40MG'
    }
});
// ==========================================================

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
const DATA_FILE = path.join(__dirname, 'db_data.json');
const MINES_GAME_DURATION_MS = 5 * 60 * 1000;
const MAX_DISPLAY_MINES = 25; // <--- [THÊM DÒNG NÀY ĐỂ SỬA LỖI BOM]
let liveUsdToVndRate = 26320;
let manualUsdToVndRate = 0;
let lastRateUpdate = null;
const RATE_API_URL = 'https://open.er-api.com/v6/latest/USD';
let isMaintenanceMode = false;

// [SỬA] Biến toàn cục cho ngưỡng cá voi, sẽ được load từ settings
///let global.WHALE_BET_THRESHOLD = 100;  Giá trị mặc định

function getActiveRate() {
    return manualUsdToVndRate > 0 ? manualUsdToVndRate : liveUsdToVndRate;
}

async function updateLiveExchangeRate() {
    try {
        const response = await axios.get(RATE_API_URL);
        if (response.data && response.data.rates && response.data.rates.VND) {
            liveUsdToVndRate = parseFloat(response.data.rates.VND);
            lastRateUpdate = new Date();
        }
    } catch (error) {
        console.error('Lỗi updateLiveExchangeRate:', error);
    }
}
const DEPOSIT_CHANNELS = {
    'V8pay - QR Bank': {
        bank: 'MBBank',
        accounts: ["823299999", "5695888888", "640456789", "327399999", "809123456"],
        accountName: 'NGUYEN CHI THANH'
    }
};

function getNextAccount(channelKey) {
    const channelInfo = DEPOSIT_CHANNELS[channelKey];
    if (!channelInfo || channelInfo.accounts.length === 0) return null;
    const index = Math.floor(Date.now() / 60000) % channelInfo.accounts.length;
    return { account: channelInfo.accounts[index], bank: channelInfo.bank, name: channelInfo.accountName };
}
const TELEGRAM_BOT_TOKEN = '8242385152:AAHvmiOBsM0ZUfqVPuMdEorINmoGD5SeKzo';
const TELEGRAM_CHAT_ID = '5996989980';
const DEPOSIT_LIMIT = 5;
const DEPOSIT_TIME_WINDOW_MS = 10 * 60 * 60 * 1000;
// const WHALE_BET_THRESHOLD = 0; // [SỬA] Đã chuyển thành biến toàn cục

//auto gửi lệnh về web 
app.get('/healthz', (req, res) => {
    // Chỉ cần trả về mã 200 OK
    res.status(200).send('OK');
});

app.use(cors());
app.use(bodyParser.json());

// === CHẶN .html TRƯỚC KHI SERVE FILE ===
// Middleware này phải đặt TRƯỚC express.static
app.use((req, res, next) => {
    const urlPath = req.url.split('?')[0];

    // Nếu URL có .html, redirect sang clean URL
    if (urlPath.endsWith('.html')) {
        const newPath = urlPath.replace('.html', '');
        const query = req.url.slice(urlPath.length);
        return res.redirect(301, newPath + query);
    }

    next();
});

// Serve static files with .html extension support
app.use(express.static(path.join(__dirname, 'public'), {
    extensions: ['html']
}));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// === CLEAN URLs: Định tuyến cho các trang không có .html ===
// Cả /page VÀ /page.html đều hoạt động (an toàn, không phá vỡ)
const servePage = (pageName) => (req, res) => {
    res.sendFile(path.join(__dirname, 'public', `${pageName}.html`));
};

// Main pages
app.get('/index', servePage('index'));
app.get('/admin', servePage('admin'));
app.get('/login', servePage('login'));
app.get('/register', servePage('register'));

// Game pages
app.get('/game', servePage('game'));
app.get('/game_reactor', servePage('game_reactor'));
app.get('/mines', servePage('mines'));
app.get('/hilo', servePage('hilo'));
app.get('/wheel', servePage('wheel'));
app.get('/trade', servePage('trade'));

// User & Transaction pages
app.get('/deposit', servePage('deposit'));
app.get('/withdraw', servePage('withdraw'));
app.get('/profile', servePage('profile'));
app.get('/activity', servePage('activity'));
app.get('/history', servePage('history'));
app.get('/notifications', servePage('notifications'));
app.get('/settings', servePage('settings'));
app.get('/service', servePage('service'));
app.get('/invite', servePage('invite'));
app.get('/vip_level', servePage('vip_level'));
app.get('/kyc_verification', servePage('kyc_verification'));
app.get('/chat', servePage('chat'));
app.get('/help', servePage('help'));
app.get('/community-chat', servePage('community-chat'));

// Detail & Sub-pages
app.get('/deposit_crypto', servePage('deposit_crypto'));
app.get('/deposit_fiat_detail', servePage('deposit_fiat_detail'));
app.get('/withdraw_crypto', servePage('withdraw_crypto'));
app.get('/withdraw_fiat', servePage('withdraw_fiat'));
app.get('/fiat_payment_qrcode', servePage('fiat_payment_qrcode'));
app.get('/bind_card', servePage('bind_card'));
app.get('/change_password', servePage('change_password'));
app.get('/change_phone', servePage('change_phone'));
app.get('/set_email', servePage('set_email'));
app.get('/set_fund_password', servePage('set_fund_password'));
app.get('/set_avatar', servePage('set_avatar'));
app.get('/my_assets', servePage('my_assets'));
app.get('/personal_center', servePage('personal_center'));
app.get('/history_dw', servePage('history_dw'));
app.get('/trade_detail', servePage('trade_detail'));
app.get('/kyc_step2_upload', servePage('kyc_step2_upload'));
app.get('/kyc_step3_review', servePage('kyc_step3_review'));
app.get('/forgot-password', servePage('forgot-password'));
app.get('/reset-password', servePage('reset-password'));
app.get('/placeholder', servePage('placeholder'));
app.get('/googlec2cd7e5c98a4324e', servePage('googlec2cd7e5c98a4324e'));

// Redirect invalid URLs to index (without .html)
app.use((req, res, next) => {
    if (req.url.includes('/well-known/appspecific/')) {
        return res.status(404).send();
    }

    // [SỬA] Thêm community-chat.html vào danh sách
    const validFiles = [
        'index.html', 'admin.html', 'login.html', 'register.html', 'game.html',
        'game_reactor.html', 'mines.html', 'hilo.html', 'wheel.html', 'trade.html',
        'deposit.html', 'withdraw.html', 'profile.html', 'activity.html', 'history.html',
        'notifications.html', 'settings.html', 'service.html', 'invite.html', 'vip_level.html',
        'kyc_verification.html', 'chat.html', 'help.html', 'placeholder.html',
        'deposit_crypto.html', 'deposit_fiat_detail.html', 'withdraw_crypto.html',
        'withdraw_fiat.html', 'fiat_payment_qrcode.html', 'bind_card.html',
        'change_password.html', 'change_phone.html', 'set_email.html', 'set_fund_password.html',
        'set_avatar.html', 'my_assets.html', 'personal_center.html', 'history_dw.html',
        'trade_detail.html', 'kyc_step2_upload.html', 'kyc_step3_review.html',
        'forgot-password.html', 'reset-password.html', 'googlec2cd7e5c98a4324e.html',
        'community-chat.html' // <-- THÊM DÒNG NÀY
    ];

    // Check if it's a request for an HTML file that doesn't exist
    const urlPath = req.url.split('?')[0]; // Remove query string
    const isHtmlRequest = urlPath.endsWith('.html') || (!urlPath.includes('.') && urlPath !== '/' && !urlPath.startsWith('/api'));
    const isValidFile = validFiles.some(file => urlPath === '/' + file || urlPath === '/' + file.replace('.html', ''));
    const isApiRequest = urlPath.startsWith('/api');
    const isStaticFile = urlPath.includes('.') && !urlPath.endsWith('.html');

    // Redirect invalid HTML requests to index
    if (isHtmlRequest && !isValidFile && !isApiRequest && !isStaticFile && urlPath !== '/') {
        return res.redirect('/index');
    }

    next();
});

function getAdminStats() {
    const onlineUsers = io.engine.clientsCount;
    const game120Players = Object.keys(game_40S_Bets).length;
    const boPlayers = Object.keys(game_REAL_BO_Bets).length;

    const pendingKyc = users.filter(u => u.kycStatus === 'PENDING').length;

    let realCrashPlayers = 0;
    if (crashGame && crashGame.allActivePlayers) {
        for (const userId in crashGame.allActivePlayers) {
            if (!userId.startsWith('bot_')) {
                realCrashPlayers++;
            }
        }
    }
    const minesPlayers = Object.keys(activeMinesGames).length;
    const hiloPlayers = Object.keys(activeHiloGames).length;

    return {
        onlineUsers,
        game120Players,
        boPlayers,
        realCrashPlayers,
        minesPlayers,
        hiloPlayers,
        pendingKyc
    };
}

function broadcastAdminStats() {
    try {
        const stats = getAdminStats();
        io.to('admin_room').emit('admin_stats_update', stats);
    } catch (error) {
        console.error('Lỗi broadcastAdminStats:', error);
    }
}


let users = [];
let nextUserId = 1;
let allData = {
    users: [], deposits: [], withdrawals: [], chats: [],
    gameHistory: [], allBets: [], crashHistory: [],
    gameBank: 0, boHistory: [], boGameBank: 0,
    adminLogs: [],
    notifications: [],
    globalChat: [], // [SỬA] Đảm bảo biến này được khởi tạo
    settings: {
        manualUsdToVndRate: 0,
        isMaintenanceMode: false,
        requireKyc: true,
        withdrawFee: -1,
        whaleThreshold: 100
    }
};
let nextDepositId = 1;
let nextWithdrawalId = 1;
let nextNotificationId = 1;
let next_40S_Intervention = null;
let next_BO_Intervention_Manual = null;
let current_BO_Mode = 'auto';
let current_CRASH_Mode = 'auto';
let gameBank = 0;
let nextManualCrash = null;
let forceCrashNow = false;
let crashGameHistory = allData.crashHistory || [];

// Game rig mode variables
let next_Crash_Intervention = null;
let minesRigMode = 'auto'; // 'auto', 'always_hit', 'always_safe', 'anti_win'
let hiloRigMode = 'auto';  // 'auto', 'always_lose', 'always_win', 'anti_win'

let activeMinesGames = {};
let activeHiloGames = {};

async function logAdminAction(adminUsername, targetUserId, actionMessage) {
    if (!allData.adminLogs) {
        allData.adminLogs = [];
    }
    allData.adminLogs.push({
        id: allData.adminLogs.length + 1,
        timestamp: new Date().toISOString(),
        admin: adminUsername,
        targetUserId: targetUserId,
        action: actionMessage
    });
    if (allData.adminLogs.length > 2000) {
        allData.adminLogs.shift();
    }
}


async function loadData() {
    try {
        const data = await fs.readFile(DATA_FILE, 'utf8');
        allData = JSON.parse(data);
        users = allData.users || [];

        if (users.length > 0) {
            nextUserId = Math.max(...users.map(u => u.id)) + 1;
        }
        if (allData.deposits && allData.deposits.length > 0) {
            nextDepositId = Math.max(...allData.deposits.map(d => d.id)) + 1;
        }
        if (allData.withdrawals && allData.withdrawals.length > 0) {
            nextWithdrawalId = Math.max(...allData.withdrawals.map(w => w.id)) + 1;
        }
        if (allData.notifications && allData.notifications.length > 0) {
            nextNotificationId = Math.max(...allData.notifications.map(n => n.id)) + 1;
        }

        if (!allData.gameHistory) allData.gameHistory = [];
        if (!allData.boHistory) allData.boHistory = [];
        if (!allData.allBets) allData.allBets = [];
        if (!allData.crashHistory) allData.crashHistory = [];
        if (!allData.adminLogs) allData.adminLogs = [];
        if (!allData.notifications) allData.notifications = [];
        allData.globalChat = allData.globalChat || [];
        if (!allData.settings) allData.settings = {
            manualUsdToVndRate: 0,
            isMaintenanceMode: false,
            requireKyc: true,
            withdrawFee: -1,
            whaleThreshold: 100
        };
        manualUsdToVndRate = allData.settings.manualUsdToVndRate || 0;
        isMaintenanceMode = allData.settings.isMaintenanceMode || false;
        global.WHALE_BET_THRESHOLD = allData.settings.whaleThreshold || 100;

        crashGameHistory = allData.crashHistory;
        gameBank = allData.gameBank || 0;
        allData.boGameBank = allData.boGameBank || 0;

        game_40S_History = allData.gameHistory || [];
        game_REAL_BO_History = allData.boHistory || [];

    } catch (error) {
        if (error.code === 'ENOENT') {
        } else {
        }
    }
}

async function saveData() {
    try {
        allData.users = users;
        allData.globalChat = allData.globalChat || [];
        allData.crashHistory = crashGameHistory;
        allData.gameHistory = game_40S_History;
        allData.boHistory = game_REAL_BO_History;
        allData.gameBank = gameBank;
        allData.boGameBank = allData.boGameBank || 0;
        allData.adminLogs = allData.adminLogs || [];
        allData.notifications = allData.notifications || [];
        allData.settings = {
            manualUsdToVndRate: manualUsdToVndRate,
            isMaintenanceMode: isMaintenanceMode,
            requireKyc: allData.settings.requireKyc,
            withdrawFee: allData.settings.withdrawFee,
            whaleThreshold: allData.settings.whaleThreshold,
            maxLossThreshold: allData.settings.maxLossThreshold
        };
        await fs.writeFile(DATA_FILE, JSON.stringify(allData, null, 4), 'utf8');
    } catch (error) {
        console.error('Lỗi saveData:', error);
    }
}

const checkMaintenance = (req, res, next) => {
    if (req.path.startsWith('/api/admin') || req.path === '/api/auth/login') {
        return next();
    }

    if (isMaintenanceMode) {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        if (token) {
            try {
                const decoded = jwt.verify(token, JWT_SECRET);
                const user = findUser('id', decoded.userId);
                if (user && user.isAdmin) {
                    return next();
                }
            } catch (e) {
            }
        }
        return res.status(503).json({ message: 'Hệ thống đang bảo trì, vui lòng quay lại sau.' });
    }

    next();
};
// Telegram webhook - đặt TRƯỚC checkMaintenance để không bị chặn
app.post('/api/telegram/webhook', bodyParser.json(), async (req, res) => {
    // Trả lời ngay để Telegram biết đã nhận (trong vòng 10 giây)
    res.json({ ok: true });

    try {
        console.log('📨 Nhận webhook từ Telegram:', JSON.stringify(req.body, null, 2));
        const update = req.body;

        // Handle text messages (for admin commands)
        if (update.message && update.message.text) {
            const chatId = update.message.chat.id;
            const messageText = update.message.text;

            // Kiểm tra chat_id có phải admin không
            if (chatId.toString() === TELEGRAM_CHAT_ID) {
                await handleAdminCommand(chatId, messageText);
            }
            return;
        }

        if (!update.callback_query) {
            console.log('⚠️ Không có callback_query trong update');
            return;
        }

        const callbackData = update.callback_query.data;
        const message = update.callback_query.message;
        const chatId = update.callback_query.message.chat.id;
        const callbackQueryId = update.callback_query.id;

        console.log(`🔍 Callback data: ${callbackData}, Chat ID: ${chatId}`);

        // Kiểm tra chat_id có phải admin không
        if (chatId.toString() !== TELEGRAM_CHAT_ID) {
            console.log(`❌ Unauthorized: Chat ID ${chatId} không khớp với ${TELEGRAM_CHAT_ID}`);
            // Vẫn trả lời callback để không bị timeout
            try {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQueryId,
                    text: '❌ Unauthorized',
                    show_alert: true
                });
            } catch (e) { }
            return;
        }

        // Handle enhanced admin menu commands
        if (callbackData === 'admin_menu') {
            await sendEnhancedAdminMenu(chatId);
            try {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQueryId,
                    text: '📋 Menu quản trị',
                    show_alert: false
                });
            } catch (e) { }
            return;
        } else if (callbackData === 'game_control') {
            await sendEnhancedGameControlMenu(chatId);
            try {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQueryId,
                    text: '🎮 Chỉnh cầu game',
                    show_alert: false
                });
            } catch (e) { }
            return;
        } else if (callbackData === 'system_stats') {
            await sendSystemStats(chatId);
            try {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQueryId,
                    text: '📊 Thống kê hệ thống',
                    show_alert: false
                });
            } catch (e) { }
            return;
        } else if (callbackData === 'system_settings') {
            await sendSystemSettingsMenu(chatId);
            try {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQueryId,
                    text: '⚙️ Cài đặt hệ thống',
                    show_alert: false
                });
            } catch (e) { }
            return;
        } else if (callbackData === 'user_management') {
            await sendUserManagementMenu(chatId);
            try {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQueryId,
                    text: '👥 Quản lý người dùng',
                    show_alert: false
                });
            } catch (e) { }
            return;
        } else if (callbackData === 'transaction_management') {
            await sendTransactionManagementMenu(chatId);
            try {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQueryId,
                    text: '💰 Quản lý giao dịch',
                    show_alert: false
                });
            } catch (e) { }
            return;
        } else if (callbackData === 'send_notification') {
            await sendNotificationMenu(chatId);
            try {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQueryId,
                    text: '🔔 Gửi thông báo',
                    show_alert: false
                });
            } catch (e) { }
            return;
        } else if (callbackData.startsWith('set_bo_mode_')) {
            const mode = callbackData.replace('set_bo_mode_', '');
            current_BO_Mode = mode;
            await sendTelegramMessage(`🔄 Đã chuyển BO Mode sang: ${mode.toUpperCase()}`);
            try {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQueryId,
                    text: `✅ Đã đặt BO Mode: ${mode.toUpperCase()}`,
                    show_alert: false
                });
            } catch (e) { }
            return;
        } else if (callbackData.startsWith('set_crash_mode_')) {
            const mode = callbackData.replace('set_crash_mode_', '');
            crashGame.mode = mode;
            await sendTelegramMessage(`🔄 Đã chuyển Crash Mode sang: ${mode.toUpperCase()}`);
            try {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQueryId,
                    text: `✅ Đã đặt Crash Mode: ${mode.toUpperCase()}`,
                    show_alert: false
                });
            } catch (e) { }
            return;
        } else if (callbackData.startsWith('deposit_approve_')) {
            const depositId = parseInt(callbackData.replace('deposit_approve_', ''));
            console.log(`✅ Xử lý duyệt lệnh nạp #${depositId}`);

            const result = await processDepositAction(depositId, 'approve', 'Telegram Admin');

            // Trả lời callback query ngay để Telegram biết đã nhận
            try {
                const answerUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`;
                await axios.post(answerUrl, {
                    callback_query_id: callbackQueryId,
                    text: result.success ? '✅ Đã duyệt lệnh nạp!' : `❌ ${result.message}`,
                    show_alert: false
                });
            } catch (err) {
                console.error('Lỗi answerCallbackQuery:', err.message);
            }

            // Cập nhật tin nhắn
            if (result.success) {
                try {
                    const editUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`;
                    const originalText = message.text || '';
                    const cleanText = originalText.replace(/\\/g, '').replace(/\*/g, '');
                    const newText = `✅ *ĐÃ DUYỆT*

${cleanText}

_Duyệt bởi: Telegram Admin_`;

                    await axios.post(editUrl, {
                        chat_id: chatId,
                        message_id: message.message_id,
                        text: newText.replace(/-/g, '\\-').replace(/\./g, '\\.').replace(/!/g, '\\!')
                            .replace(/_/g, '\\_').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
                            .replace(/\+/g, '\\+').replace(/=/g, '\\=').replace(/{/g, '\\{')
                            .replace(/}/g, '\\}').replace(/\n/g, '\\n'),
                        parse_mode: 'MarkdownV2'
                    });
                } catch (err) {
                    console.error('Lỗi editMessageText:', err.message);
                }
            }

        } else if (callbackData.startsWith('deposit_reject_')) {
            const depositId = parseInt(callbackData.replace('deposit_reject_', ''));
            console.log(`❌ Xử lý từ chối lệnh nạp #${depositId}`);

            const result = await processDepositAction(depositId, 'reject', 'Telegram Admin');

            // Trả lời callback query ngay để Telegram biết đã nhận
            try {
                const answerUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`;
                await axios.post(answerUrl, {
                    callback_query_id: callbackQueryId,
                    text: result.success ? '❌ Đã từ chối lệnh nạp!' : `❌ ${result.message}`,
                    show_alert: false
                });
            } catch (err) {
                console.error('Lỗi answerCallbackQuery:', err.message);
            }

            // Cập nhật tin nhắn
            if (!result.success) {
                try {
                    const editUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`;
                    const originalText = message.text || '';
                    const cleanText = originalText.replace(/\\/g, '').replace(/\*/g, '');
                    const newText = `❌ *ĐÃ TỪ CHỐI*

${cleanText}

_Từ chối bởi: Telegram Admin_`;

                    await axios.post(editUrl, {
                        chat_id: chatId,
                        message_id: message.message_id,
                        text: newText.replace(/-/g, '\\-').replace(/\./g, '\\.').replace(/!/g, '\\!')
                            .replace(/_/g, '\\_').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
                            .replace(/\+/g, '\\+').replace(/=/g, '\\=').replace(/{/g, '\\{')
                            .replace(/}/g, '\\}').replace(/\n/g, '\\n'),
                        parse_mode: 'MarkdownV2'
                    });
                } catch (err) {
                    console.error('Lỗi editMessageText:', err.message);
                }
            }
        } else {
            console.log(`⚠️ Callback data không nhận dạng được: ${callbackData}`);
            // Trả lời callback để không bị timeout
            try {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQueryId,
                    text: '⚠️ Không nhận dạng được lệnh',
                    show_alert: false
                });
            } catch (e) { }
        }
    } catch (error) {
        console.error('❌ Lỗi xử lý Telegram webhook:', error);
        console.error('Stack:', error.stack);
        // Không trả về lỗi HTTP vì đã trả về ok: true ở đầu
    }
});

app.post('/api/telegram', async (req, res) => {
    res.send('ok');
    try {
        const { message, callback_query } = req.body;

        if (message) {
            const { chat, text } = message;
            const chatId = chat.id;

            // Kiểm tra xem có lệnh admin nào được gửi không
            if (text.startsWith('/')) {
                await handleAdminCommand(chatId, text);
                return;
            }

            // Xử lý lệnh nạp tiền
            const depositMatch = text.match(/^\/nap\s+(\d+)$/);
            if (depositMatch) {
                const amount = parseInt(depositMatch[1], 10);
                if (amount > 0) {
                    const depositId = await createDeposit(amount);
                    await sendTelegramMessage(`💸 *ĐỀ NẠP MỚI*
Số tiền: ${amount.toLocaleString()} VND
ID: ${depositId}`, depositId);
                } else {
                    await sendTelegramMessage('⚠️ Số tiền nạp phải lớn hơn 0 VND.');
                }
                return;
            }

            // Xử lý lệnh rút tiền
            const withdrawMatch = text.match(/^\/rut\s+(\d+)$/);
            if (withdrawMatch) {
                const amount = parseInt(withdrawMatch[1], 10);
                if (amount > 0) {
                    const result = await processWithdraw(amount);
                    if (result.success) {
                        await sendTelegramMessage(`💸 *RÚT TIỀN THÀNH CÔNG*
Số tiền: ${amount.toLocaleString()} VND`);
                    } else {
                        await sendTelegramMessage(`⚠️ ${result.message}`);
                    }
                } else {
                    await sendTelegramMessage('⚠️ Số tiền rút phải lớn hơn 0 VND.');
                }
                return;
            }

            // Xử lý lệnh khác
            await sendTelegramMessage('❓ Lệnh không nhận dạng được. Gửi /admin để mở menu quản trị.');
        } else if (callback_query) {
            const { id: callbackQueryId, data: callbackData, message } = callback_query;
            const chatId = message.chat.id;

            if (callbackData === 'admin_menu') {
                await sendAdminMenu(chatId);
                return;
            }

            if (callbackData === 'game_control') {
                await sendGameControlMenu(chatId);
                return;
            }

            // Xử lý lệnh duyệt/từ chối lệnh nạp
            const approveMatch = callbackData.match(/^deposit_approve_(\d+)$/);
            const rejectMatch = callbackData.match(/^deposit_reject_(\d+)$/);
            if (approveMatch || rejectMatch) {
                const depositId = approveMatch ? parseInt(approveMatch[1], 10) : parseInt(rejectMatch[1], 10);
                const result = await processDeposit(depositId, !!approveMatch);

                // Trả lời callback query
                try {
                    const answerUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`;
                    await axios.post(answerUrl, {
                        callback_query_id: callbackQueryId,
                        text: result.success ? '❌ Đã từ chối lệnh nạp!' : `❌ ${result.message}`,
                        show_alert: false
                    });
                } catch (err) {
                    console.error('Lỗi answerCallbackQuery:', err.message);
                }

                // Cập nhật tin nhắn
                if (result.success) {
                    try {
                        const editUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`;
                        const originalText = message.text || '';
                        const cleanText = originalText.replace(/\\/g, '').replace(/\*/g, '');
                        const newText = `❌ *ĐÃ TỪ CHỐI*

${cleanText}

_Từ chối bởi: Telegram Admin_`;

                        await axios.post(editUrl, {
                            chat_id: chatId,
                            message_id: message.message_id,
                            text: newText.replace(/-/g, '\\-').replace(/\./g, '\\.').replace(/!/g, '\\!')
                                .replace(/_/g, '\\_').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
                                .replace(/\+/g, '\\+').replace(/=/g, '\\=').replace(/{/g, '\\{')
                                .replace(/}/g, '\\}').replace(/\n/g, '\\n'),
                            parse_mode: 'MarkdownV2'
                        });
                    } catch (err) {
                        console.error('Lỗi editMessageText:', err.message);
                    }
                }
            } else {
                console.log(`⚠️ Callback data không nhận dạng được: ${callbackData}`);
                // Trả lời callback để không bị timeout
                try {
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                        callback_query_id: callbackQueryId,
                        text: '⚠️ Không nhận dạng được lệnh',
                        show_alert: false
                    });
                } catch (e) { }
            }
        } else {
            console.log('⚠️ Dữ liệu không hợp lệ:', req.body);
        }
    } catch (error) {
        console.error('❌ Lỗi xử lý Telegram webhook:', error);
        console.error('Stack:', error.stack);
        // Không trả về lỗi HTTP vì đã trả về ok: true ở đầu
    }
});

app.use('/api', checkMaintenance);


async function sendTelegramMessage(message, depositId = null) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;

    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    try {
        const payload = {
            chat_id: TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: 'Markdown' // Đổi từ MarkdownV2 sang Markdown thường hoặc HTML cho an toàn
        };

        // Thêm nút duyệt/từ chối nếu có depositId
        if (depositId) {
            payload.reply_markup = {
                inline_keyboard: [[
                    { text: '✅ DUYỆT NGAY', callback_data: `deposit_approve_${depositId}` },
                    { text: '❌ TỪ CHỐI', callback_data: `deposit_reject_${depositId}` }
                ]]
            };
        }

        await axios.post(url, payload);
    } catch (error) {
        console.error('Lỗi sendTelegramMessage:', error.message);
    }
}

// === Enhanced Telegram Admin Functions ===

// Enhanced admin command handler
async function handleAdminCommand(chatId, messageText) {
    // Show admin menu when user sends /admin or /menu
    if (messageText === '/admin' || messageText === '/menu') {
        await sendEnhancedAdminMenu(chatId);
        return;
    }

    // Handle other specific commands
    if (messageText === '/stats') {
        await sendSystemStats(chatId);
        return;
    }

    if (messageText === '/games') {
        await sendGameControlMenu(chatId);
        return;
    }

    if (messageText === '/settings') {
        await sendSystemSettingsMenu(chatId);
        return;
    }

    // Handle other admin commands here if needed
    await sendTelegramMessage('❓ Lệnh không nhận dạng được. Gửi /admin để mở menu quản trị.');
}

// Enhanced admin menu with more options
async function sendEnhancedAdminMenu(chatId) {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    try {
        await axios.post(url, {
            chat_id: chatId,
            text: '*🎮 MENU BẺ CẦU GAME*\n\nChọn game cần chỉnh cầu:',
            parse_mode: 'MarkdownV2',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '💣 BẺ CẦU BO', callback_data: 'rig_bo_menu' },
                        { text: '🚀 BẺ CẦU CRASH', callback_data: 'rig_crash_menu' }
                    ],
                    [
                        { text: '🎲 BẺ CẦU 40S', callback_data: 'rig_40s_menu' },
                        { text: '💎 BẺ CẦU MINES', callback_data: 'rig_mines_menu' }
                    ],
                    [
                        { text: '🃏 BẺ CẦU HILO', callback_data: 'rig_hilo_menu' }
                    ]
                ]
            }
        });
    } catch (error) {
        console.error('Lỗi sendEnhancedAdminMenu:', error.response?.data || error.message);
    }
}

// System stats menu
async function sendSystemStats(chatId) {
    // Get current stats
    const stats = getAdminStats();
    const totalUsers = users.length;
    const totalBalance = users.reduce((sum, user) => sum + (user.balance || 0), 0);
    const pendingDeposits = allData.deposits ? allData.deposits.filter(d => d.status === 'PENDING').length : 0;
    const pendingWithdrawals = allData.withdrawals ? allData.withdrawals.filter(w => w.status === 'PENDING').length : 0;

    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    try {
        await axios.post(url, {
            chat_id: chatId,
            text: `*📊 THỐNG KÊ HỆ THỐNG*
            
👥 Người dùng online: ${stats.onlineUsers}
👥 Tổng số người dùng: ${totalUsers}
💰 Tổng số dư (USDT): ${totalBalance.toFixed(2)}
📥 Lệnh nạp chờ: ${pendingDeposits}
📤 Lệnh rút chờ: ${pendingWithdrawals}
🎲 Người chơi Game 40s: ${stats.game120Players}
💣 Người chơi BO: ${stats.boPlayers}
🚀 Người chơi Crash: ${stats.realCrashPlayers}
💎 Người chơi Mines: ${stats.minesPlayers}
🃏 Người chơi Hilo: ${stats.hiloPlayers}
📝 KYC chờ duyệt: ${stats.pendingKyc}`,
            parse_mode: 'MarkdownV2',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '⬅️ Quay lại', callback_data: 'admin_menu' }]
                ]
            }
        });
    } catch (error) {
        console.error('Lỗi sendSystemStats:', error);
    }
}

// System settings menu
async function sendSystemSettingsMenu(chatId) {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    try {
        await axios.post(url, {
            chat_id: chatId,
            text: `*⚙️ CÀI ĐẶT HỆ THỐNG*
            
Hiện tại:
- Tỷ giá: ${getActiveRate()} VND/USDT
- Chế độ bảo trì: ${isMaintenanceMode ? 'BẬT' : 'TẮT'}
- Yêu cầu KYC: ${allData.settings.requireKyc ? 'BẬT' : 'TẮT'}
- Ngưỡng cá voi: ${allData.settings.whaleThreshold} USDT

Chọn cài đặt cần thay đổi:`,
            parse_mode: 'MarkdownV2',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '💰 Đổi Tỷ Giá', callback_data: 'change_rate' },
                        { text: '🔧 Bảo Trì', callback_data: 'toggle_maintenance' }
                    ],
                    [
                        { text: '👤 KYC Bắt Buộc', callback_data: 'toggle_kyc' },
                        { text: '🐋 Ngưỡng Cá Voi', callback_data: 'change_whale_threshold' }
                    ],
                    [{ text: '⬅️ Quay lại', callback_data: 'admin_menu' }]
                ]
            }
        });
    } catch (error) {
        console.error('Lỗi sendSystemSettingsMenu:', error);
    }
}

// Transaction management menu
async function sendTransactionManagementMenu(chatId) {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    try {
        await axios.post(url, {
            chat_id: chatId,
            text: '*💰 QUẢN LÝ GIAO DỊCH*\\n\\nChọn loại giao dịch cần quản lý:',
            parse_mode: 'MarkdownV2',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '📥 Lệnh Nạp', callback_data: 'manage_deposits' },
                        { text: '📤 Lệnh Rút', callback_data: 'manage_withdrawals' }
                    ],
                    [{ text: '⬅️ Quay lại', callback_data: 'admin_menu' }]
                ]
            }
        });
    } catch (error) {
        console.error('Lỗi sendTransactionManagementMenu:', error);
    }
}

// Notification menu
async function sendNotificationMenu(chatId) {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    try {
        await axios.post(url, {
            chat_id: chatId,
            text: '*🔔 GỬI THÔNG BÁO*\\n\\nChọn loại thông báo:',
            parse_mode: 'MarkdownV2',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '📢 Thông Báo Chung', callback_data: 'broadcast_notification' },
                        { text: '👤 Thông Báo Riêng', callback_data: 'private_notification' }
                    ],
                    [{ text: '⬅️ Quay lại', callback_data: 'admin_menu' }]
                ]
            }
        });
    } catch (error) {
        console.error('Lỗi sendNotificationMenu:', error);
    }
}

// User management menu
async function sendUserManagementMenu(chatId) {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    try {
        await axios.post(url, {
            chat_id: chatId,
            text: '*👥 QUẢN LÝ NGƯỜI DÙNG*\\n\\nChọn chức năng:',
            parse_mode: 'MarkdownV2',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '🔍 Tìm Người Dùng', callback_data: 'search_user' },
                        { text: '💰 Điều Chỉnh Số Dư', callback_data: 'adjust_balance' }
                    ],
                    [
                        { text: '🔒 Khóa Tài Khoản', callback_data: 'ban_user' },
                        { text: '🔓 Mở Khóa TK', callback_data: 'unban_user' }
                    ],
                    [{ text: '⬅️ Quay lại', callback_data: 'admin_menu' }]
                ]
            }
        });
    } catch (error) {
        console.error('Lỗi sendUserManagementMenu:', error);
    }
}

// Menu điều khiển Game Chính
async function sendEnhancedGameControlMenu(chatId) {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    try {
        // Lấy trạng thái hiện tại
        const boInfo = current_BO_Mode === 'auto' ? '🤖 Auto' : (current_BO_Mode === 'manual' ? '✋ Thủ công' : '⚡ Bẻ cầu');
        const crashInfo = crashGame.mode === 'auto' ? '🤖 Auto' : '⚡ Bẻ cầu';

        await axios.post(url, {
            chat_id: chatId,
            text: `🎮 **TRUNG TÂM ĐIỀU KHIỂN GAME** 🎮\n\n📊 Trạng thái:\n• BO: ${boInfo}\n• Crash: ${crashInfo}\n\n👇 Chọn game cần can thiệp:`,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '📈 BO (Binary Option)', callback_data: 'rig_bo_menu' },
                        { text: '🚀 Crash (Nhảy Dù)', callback_data: 'rig_crash_menu' }
                    ],
                    [
                        { text: '🎲 40S (Chẵn/Lẻ)', callback_data: 'rig_40s_menu' },
                        { text: '💣 Mines (Dò Mìn)', callback_data: 'rig_mines_menu' }
                    ],
                    [
                        { text: '🃏 Hi-Lo (Cao Thấp)', callback_data: 'rig_hilo_menu' },
                        { text: '⚙️ CÀI ĐẶT AUTO', callback_data: 'auto_modes_menu' }
                    ],
                    [{ text: '⬅️ Quay về Menu Chính', callback_data: 'admin_menu' }]
                ]
            }
        });
    } catch (error) {
        console.error('Lỗi sendEnhancedGameControlMenu:', error.message);
    }
}

// BO Rigging Menu
async function sendBORigMenu(chatId) {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    try {
        await axios.post(url, {
            chat_id: chatId,
            text: `*💣 BẺ CẦU BO \\(BINARY OPTIONS\\)*

Chế độ hiện tại: *${current_BO_Mode.toUpperCase()}*

Chọn kết quả cho phiên tiếp theo:`,
            parse_mode: 'MarkdownV2',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '🟢 MUA (GREEN)', callback_data: 'rig_bo_buy' },
                        { text: '🔴 BÁN (RED)', callback_data: 'rig_bo_sell' }
                    ],
                    [
                        { text: '🔄 Bẻ Cầu (Anti-Majority)', callback_data: 'set_bo_mode_anti_majority' }
                    ],
                    [
                        { text: '☀️ Chế Độ Ngày', callback_data: 'set_bo_mode_day' },
                        { text: '🌙 Chế Độ Đêm', callback_data: 'set_bo_mode_night' }
                    ],
                    [
                        { text: '🤖 Auto', callback_data: 'set_bo_mode_auto' }
                    ],
                    [{ text: '⬅️ Quay lại', callback_data: 'game_control' }]
                ]
            }
        });
    } catch (error) {
        console.error('Lỗi sendBORigMenu:', error);
    }
}

// Crash Rigging Menu - NÂNG CẤP VỚI CÁC RANGE
async function sendCrashRigMenu(chatId) {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    try {
        await axios.post(url, {
            chat_id: chatId,
            text: `*🚀 BẺ CẦU CRASH*

Chế độ hiện tại: *${crashGame.mode.toUpperCase()}*
Trạng thái: *${crashGame.state}*

Chọn hệ số crash cho phiên tiếp theo:`,
            parse_mode: 'MarkdownV2',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '⚡ CHO NỔ NGAY \\(Đang Bay\\)', callback_data: 'crash_force_instant' }
                    ],
                    [
                        { text: '💥 Nổ Ngay (1.0x)', callback_data: 'rig_crash_1.0' },
                        { text: '⚡ Dưới 2x', callback_data: 'rig_crash_range_low' }
                    ],
                    [
                        { text: '📊 2x\\-5x', callback_data: 'rig_crash_range_mid' },
                        { text: '🔥 10x\\-20x', callback_data: 'rig_crash_range_high' }
                    ],
                    [
                        { text: '💎 30x\\-50x', callback_data: 'rig_crash_range_vhigh' },
                        { text: '🚀 50x\\+', callback_data: 'rig_crash_range_ultra' }
                    ],
                    [
                        { text: '🔄 Bẻ Cầu \\(Anti\\)', callback_data: 'set_crash_mode_anti_majority' }
                    ],
                    [
                        { text: '🤖 Auto', callback_data: 'set_crash_mode_auto' }
                    ],
                    [{ text: '⬅️ Quay lại', callback_data: 'game_control' }]
                ]
            }
        });
    } catch (error) {
        console.error('Lỗi sendCrashRigMenu:', error.response?.data || error.message);
    }
}

// 40S Game Rigging Menu
async function send40sRigMenu(chatId) {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    try {
        await axios.post(url, {
            chat_id: chatId,
            text: `*🎲 BẺ CẦU GAME 40S \\(1\\-20\\)*\n\nChọn số kết quả cho phiên tiếp theo:`,
            parse_mode: 'MarkdownV2',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '1️⃣', callback_data: 'rig_40s_1' },
                        { text: '2️⃣', callback_data: 'rig_40s_2' },
                        { text: '3️⃣', callback_data: 'rig_40s_3' },
                        { text: '4️⃣', callback_data: 'rig_40s_4' },
                        { text: '5️⃣', callback_data: 'rig_40s_5' }
                    ],
                    [
                        { text: '6️⃣', callback_data: 'rig_40s_6' },
                        { text: '7️⃣', callback_data: 'rig_40s_7' },
                        { text: '8️⃣', callback_data: 'rig_40s_8' },
                        { text: '9️⃣', callback_data: 'rig_40s_9' },
                        { text: '🔟', callback_data: 'rig_40s_10' }
                    ],
                    [
                        { text: '1️⃣1️⃣', callback_data: 'rig_40s_11' },
                        { text: '1️⃣2️⃣', callback_data: 'rig_40s_12' },
                        { text: '1️⃣3️⃣', callback_data: 'rig_40s_13' },
                        { text: '1️⃣4️⃣', callback_data: 'rig_40s_14' },
                        { text: '1️⃣5️⃣', callback_data: 'rig_40s_15' }
                    ],
                    [
                        { text: '1️⃣6️⃣', callback_data: 'rig_40s_16' },
                        { text: '1️⃣7️⃣', callback_data: 'rig_40s_17' },
                        { text: '1️⃣8️⃣', callback_data: 'rig_40s_18' },
                        { text: '1️⃣9️⃣', callback_data: 'rig_40s_19' },
                        { text: '2️⃣0️⃣', callback_data: 'rig_40s_20' }
                    ],
                    [
                        { text: '🔄 Bẻ Cầu (Anti-Majority)', callback_data: 'set_40s_anti_majority' }
                    ],
                    [
                        { text: '🤖 Auto', callback_data: 'set_40s_auto' }
                    ],
                    [{ text: '⬅️ Quay lại', callback_data: 'game_control' }]
                ]
            }
        });
    } catch (error) {
        console.error('Lỗi send40sRigMenu:', error);
    }
}

// Mines Rigging Menu
async function sendMinesRigMenu(chatId) {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    try {
        await axios.post(url, {
            chat_id: chatId,
            text: `*💎 BẺ CẦU MINES*\n\nChọn chế độ:`,
            parse_mode: 'MarkdownV2',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '💣 Player Luôn Chạm Mines', callback_data: 'rig_mines_always_hit' },
                    ],
                    [
                        { text: '💎 Player Luôn An Toàn', callback_data: 'rig_mines_always_safe' }
                    ],
                    [
                        { text: '🔄 Bẻ Cầu (Anti-Win)', callback_data: 'set_mines_anti_win' }
                    ],
                    [
                        { text: '🤖 Auto', callback_data: 'set_mines_auto' }
                    ],
                    [{ text: '⬅️ Quay lại', callback_data: 'game_control' }]
                ]
            }
        });
    } catch (error) {
        console.error('Lỗi sendMinesRigMenu:', error);
    }
}

// Hilo Rigging Menu
async function sendHiloRigMenu(chatId) {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    try {
        await axios.post(url, {
            chat_id: chatId,
            text: `*🃏 BẺ CẦU HILO*\n\nChọn chế độ:`,
            parse_mode: 'MarkdownV2',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '❌ Player Luôn Thua', callback_data: 'rig_hilo_always_lose' },
                    ],
                    [
                        { text: '✅ Player Luôn Thắng', callback_data: 'rig_hilo_always_win' }
                    ],
                    [
                        { text: '🔄 Bẻ Cầu (Anti-Win)', callback_data: 'set_hilo_anti_win' }
                    ],
                    [
                        { text: '🤖 Auto', callback_data: 'set_hilo_auto' }
                    ],
                    [{ text: '⬅️ Quay lại', callback_data: 'game_control' }]
                ]
            }
        });
    } catch (error) {
        console.error('Lỗi sendHiloRigMenu:', error);
    }
}

// Auto Modes Menu
async function sendAutoModesMenu(chatId) {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    try {
        await axios.post(url, {
            chat_id: chatId,
            text: `*⚙️ CHẾ ĐỘ TỰ ĐỘNG*\n\nQuản lý chế độ tự động cho tất cả games:`,
            parse_mode: 'MarkdownV2',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: `BO: ${current_BO_Mode === 'auto' ? '✅' : '🔘'} Auto`, callback_data: 'set_bo_mode_auto' },
                        { text: `BO: ${current_BO_Mode === 'anti-majority' ? '✅' : '🔘'} Anti`, callback_data: 'set_bo_mode_anti_majority' }
                    ],
                    [
                        { text: `Crash: ${crashGame.mode === 'auto' ? '✅' : '🔘'} Auto`, callback_data: 'set_crash_mode_auto' },
                        { text: `Crash: ${crashGame.mode === 'anti-majority' ? '✅' : '🔘'} Anti`, callback_data: 'set_crash_mode_anti_majority' }
                    ],
                    [
                        { text: '🎲 40S: Auto', callback_data: 'set_40s_auto' },
                        { text: '🎲 40S: Anti', callback_data: 'set_40s_anti_majority' }
                    ],
                    [
                        { text: '💎 Mines: Auto', callback_data: 'set_mines_auto' },
                        { text: '🃏 Hilo: Auto', callback_data: 'set_hilo_auto' }
                    ],
                    [{ text: '⬅️ Quay lại', callback_data: 'game_control' }]
                ]
            }
        });
    } catch (error) {
        console.error('Lỗi sendAutoModesMenu:', error);
    }
}

// Update the webhook handler to use the enhanced functions
app.post('/api/telegram/webhook', bodyParser.json(), async (req, res) => {
    // Trả lời ngay để Telegram biết đã nhận (trong vòng 10 giây)
    res.json({ ok: true });

    try {
        console.log('📨 Nhận webhook từ Telegram:', JSON.stringify(req.body, null, 2));
        const update = req.body;

        // Handle text messages (for admin commands)
        if (update.message && update.message.text) {
            const chatId = update.message.chat.id;
            const messageText = update.message.text;

            // Kiểm tra chat_id có phải admin không
            if (chatId.toString() === TELEGRAM_CHAT_ID) {
                await handleAdminCommand(chatId, messageText);
            }
            return;
        }

        if (!update.callback_query) {
            console.log('⚠️ Không có callback_query trong update');
            return;
        }

        const callbackData = update.callback_query.data;
        const message = update.callback_query.message;
        const chatId = update.callback_query.message.chat.id;
        const callbackQueryId = update.callback_query.id;

        console.log(`🔍 Callback data: ${callbackData}, Chat ID: ${chatId}`);

        // Kiểm tra chat_id có phải admin không
        if (chatId.toString() !== TELEGRAM_CHAT_ID) {
            console.log(`❌ Unauthorized: Chat ID ${chatId} không khớp với ${TELEGRAM_CHAT_ID}`);
            // Vẫn trả lời callback để không bị timeout
            try {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQueryId,
                    text: '❌ Unauthorized',
                    show_alert: true
                });
            } catch (e) { }
            return;
        }

        // Handle enhanced admin menu commands
        if (callbackData === 'admin_menu') {
            await sendEnhancedAdminMenu(chatId);
            try {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQueryId,
                    text: '📋 Menu quản trị',
                    show_alert: false
                });
            } catch (e) { }
            return;
        } else if (callbackData === 'game_control') {
            await sendEnhancedGameControlMenu(chatId);
            try {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQueryId,
                    text: '🎮 Chỉnh cầu game',
                    show_alert: false
                });
            } catch (e) { }
            return;
        } else if (callbackData === 'system_stats') {
            await sendSystemStats(chatId);
            try {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQueryId,
                    text: '📊 Thống kê hệ thống',
                    show_alert: false
                });
            } catch (e) { }
            return;
        } else if (callbackData === 'system_settings') {
            await sendSystemSettingsMenu(chatId);
            try {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQueryId,
                    text: '⚙️ Cài đặt hệ thống',
                    show_alert: false
                });
            } catch (e) { }
            return;
        } else if (callbackData === 'user_management') {
            await sendUserManagementMenu(chatId);
            try {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQueryId,
                    text: '👥 Quản lý người dùng',
                    show_alert: false
                });
            } catch (e) { }
            return;
        } else if (callbackData === 'transaction_management') {
            await sendTransactionManagementMenu(chatId);
            try {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQueryId,
                    text: '💰 Quản lý giao dịch',
                    show_alert: false
                });
            } catch (e) { }
            return;
        } else if (callbackData === 'send_notification') {
            await sendNotificationMenu(chatId);
            try {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQueryId,
                    text: '🔔 Gửi thông báo',
                    show_alert: false
                });
            } catch (e) { }
            return;
        } else if (callbackData.startsWith('set_bo_mode_')) {
            const mode = callbackData.replace('set_bo_mode_', '');
            current_BO_Mode = mode;
            await sendTelegramMessage(`🔄 Đã chuyển BO Mode sang: ${mode.toUpperCase()}`);
            try {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQueryId,
                    text: `✅ Đã đặt BO Mode: ${mode.toUpperCase()}`,
                    show_alert: false
                });
            } catch (e) { }
            return;
        } else if (callbackData.startsWith('set_crash_mode_')) {
            const mode = callbackData.replace('set_crash_mode_', '');
            crashGame.mode = mode;
            await sendTelegramMessage(`🔄 Đã chuyển Crash Mode sang: ${mode.toUpperCase()}`);
            try {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQueryId,
                    text: `✅ Đã đặt Crash Mode: ${mode.toUpperCase()}`,
                    show_alert: false
                });
            } catch (e) { }
            return;

            // === RIG MENU HANDLERS ===
        } else if (callbackData === 'rig_bo_menu') {
            await sendBORigMenu(chatId);
            try {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQueryId,
                    text: '💣 Bẻ cầu BO',
                    show_alert: false
                });
            } catch (e) { }
            return;
        } else if (callbackData === 'rig_crash_menu') {
            await sendCrashRigMenu(chatId);
            try {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQueryId,
                    text: '🚀 Bẻ cầu Crash',
                    show_alert: false
                });
            } catch (e) { }
            return;
        } else if (callbackData === 'rig_40s_menu') {
            await send40sRigMenu(chatId);
            try {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQueryId,
                    text: '🎲 Bẻ cầu 40S',
                    show_alert: false
                });
            } catch (e) { }
            return;
        } else if (callbackData === 'rig_mines_menu') {
            await sendMinesRigMenu(chatId);
            try {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQueryId,
                    text: '💎 Bẻ cầu Mines',
                    show_alert: false
                });
            } catch (e) { }
            return;
        } else if (callbackData === 'rig_hilo_menu') {
            await sendHiloRigMenu(chatId);
            try {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQueryId,
                    text: '🃏 Bẻ cầu Hilo',
                    show_alert: false
                });
            } catch (e) { }
            return;
        } else if (callbackData === 'auto_modes_menu') {
            await sendAutoModesMenu(chatId);
            try {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQueryId,
                    text: '⚙️ Chế độ tự động',
                    show_alert: false
                });
            } catch (e) { }
            return;

            // === BO RIG ACTIONS ===
        } else if (callbackData === 'rig_bo_buy') {
            next_BO_Intervention_Manual = { mode: 'manual', type: 'boResult', value: 'BO_MUA' };
            await sendTelegramMessage(`✅ Đã đặt BO phiên tiếp theo: *MUA \\(GREEN\\)*`);
            try {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQueryId,
                    text: '✅ Phiên tiếp: MUA (GREEN)',
                    show_alert: true
                });
            } catch (e) { }
            return;
        } else if (callbackData === 'rig_bo_sell') {
            next_BO_Intervention_Manual = { mode: 'manual', type: 'boResult', value: 'BO_BAN' };
            await sendTelegramMessage(`✅ Đã đặt BO phiên tiếp theo: *BÁN \\(RED\\)*`);
            try {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQueryId,
                    text: '✅ Phiên tiếp: BÁN (RED)',
                    show_alert: true
                });
            } catch (e) { }
            return;

            // === CRASH RIG ACTIONS ===
        } else if (callbackData === 'rig_crash_1.0') {
            // Nổ ngay 1.0x
            next_Crash_Intervention = { mode: 'manual', multiplier: 1.0 };
            await sendTelegramMessage(`✅ Đã đặt Crash *NỔ NGAY*: *1\\.0x*`);
            try {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQueryId,
                    text: '✅ Phiên tiếp: NỔ NGAY 1.0x',
                    show_alert: true
                });
            } catch (e) { }
            return;
        } else if (callbackData === 'rig_crash_range_low') {
            // Dưới 2x: chọn ngẫu nhiên từ 1.01 đến 1.99
            const multiplier = parseFloat((1.01 + Math.random() * 0.98).toFixed(2));
            next_Crash_Intervention = { mode: 'manual', multiplier: multiplier };
            await sendTelegramMessage(`✅ Đã đặt Crash (Dưới 2x): *${multiplier}x*`);
            try {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQueryId,
                    text: `✅ Phiên tiếp: ${multiplier}x`,
                    show_alert: true
                });
            } catch (e) { }
            return;
        } else if (callbackData === 'rig_crash_range_mid') {
            // 2x-5x: chọn ngẫu nhiên từ 2.0 đến 5.0
            const multiplier = parseFloat((2.0 + Math.random() * 3.0).toFixed(2));
            next_Crash_Intervention = { mode: 'manual', multiplier: multiplier };
            await sendTelegramMessage(`✅ Đã đặt Crash (2x\\-5x): *${multiplier}x*`);
            try {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQueryId,
                    text: `✅ Phiên tiếp: ${multiplier}x`,
                    show_alert: true
                });
            } catch (e) { }
            return;
        } else if (callbackData === 'rig_crash_range_high') {
            // 10x-20x: chọn ngẫu nhiên từ 10.0 đến 20.0
            const multiplier = parseFloat((10.0 + Math.random() * 10.0).toFixed(2));
            next_Crash_Intervention = { mode: 'manual', multiplier: multiplier };
            await sendTelegramMessage(`✅ Đã đặt Crash (10x\\-20x): *${multiplier}x*`);
            try {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQueryId,
                    text: `✅ Phiên tiếp: ${multiplier}x`,
                    show_alert: true
                });
            } catch (e) { }
            return;
        } else if (callbackData === 'rig_crash_range_vhigh') {
            // 30x-50x: chọn ngẫu nhiên từ 30.0 đến 50.0
            const multiplier = parseFloat((30.0 + Math.random() * 20.0).toFixed(2));
            next_Crash_Intervention = { mode: 'manual', multiplier: multiplier };
            await sendTelegramMessage(`✅ Đã đặt Crash (30x\\-50x): *${multiplier}x*`);
            try {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQueryId,
                    text: `✅ Phiên tiếp: ${multiplier}x`,
                    show_alert: true
                });
            } catch (e) { }
            return;
        } else if (callbackData === 'rig_crash_range_ultra') {
            // 50x+: chọn ngẫu nhiên từ 50.0 đến 200.0
            const multiplier = parseFloat((50.0 + Math.random() * 150.0).toFixed(2));
            next_Crash_Intervention = { mode: 'manual', multiplier: multiplier };
            await sendTelegramMessage(`✅ Đã đặt Crash (50x\\+): *${multiplier}x*`);
            try {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQueryId,
                    text: `✅ Phiên tiếp: ${multiplier}x`,
                    show_alert: true
                });
            } catch (e) { }
            return;
        } else if (callbackData === 'crash_force_instant') {
            // NỔ NGAY TRONG LÚC ĐANG BAY
            if (crashGame.state === 'RUNNING') {
                forceCrashNow = true; // Đặt cờ để nổ ngay
                await sendTelegramMessage(`⚡ *ĐÃ CHO NỔ NGAY LẬP TỨC\\!*\n\nMay bay sẽ nổ ở hệ số hiện tại: *${crashGame.multiplier.toFixed(2)}x*`);
                try {
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                        callback_query_id: callbackQueryId,
                        text: `⚡ CHO NỔ NGAY @ ${crashGame.multiplier.toFixed(2)}x`,
                        show_alert: true
                    });
                } catch (e) { }
            } else {
                await sendTelegramMessage(`⚠️ *KHÔNG THỂ CHO NỔ\\!*\n\nGame chưa bay hoặc đã kết thúc\\. Trạng thái hiện tại: *${crashGame.state}*`);
                try {
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                        callback_query_id: callbackQueryId,
                        text: `⚠️ Không thể nổ! Trạng thái: ${crashGame.state}`,
                        show_alert: true
                    });
                } catch (e) { }
            }
            return;

            // === 40S RIG ACTIONS ===
        } else if (callbackData.startsWith('rig_40s_')) {
            const number = parseInt(callbackData.replace('rig_40s_', ''));
            next_40S_Intervention = { mode: 'manual', type: 'setNumber', value: number };
            await sendTelegramMessage(`✅ Đã đặt Game 40S phiên tiếp theo: *${number}*`);
            try {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQueryId,
                    text: `✅ Phiên tiếp: Số ${number}`,
                    show_alert: true
                });
            } catch (e) { }
            return;
        } else if (callbackData === 'set_40s_auto') {
            next_40S_Intervention = null;
            await sendTelegramMessage(`🤖 Đã chuyển Game 40S sang chế độ *AUTO*`);
            try {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQueryId,
                    text: '✅ 40S: Auto',
                    show_alert: false
                });
            } catch (e) { }
            return;
        } else if (callbackData === 'set_40s_anti_majority') {
            next_40S_Intervention = { mode: 'anti-majority' };
            await sendTelegramMessage(`🔄 Đã bật chế độ *Bẻ Cầu* cho Game 40S`);
            try {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQueryId,
                    text: '✅ 40S: Bẻ Cầu',
                    show_alert: false
                });
            } catch (e) { }
            return;

            // === MINES RIG ACTIONS ===
        } else if (callbackData === 'rig_mines_always_hit') {
            minesRigMode = 'always_hit';
            await sendTelegramMessage(`💣 Mines: Player luôn chạm mines`);
            try {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQueryId,
                    text: '✅ Mines: Luôn chạm',
                    show_alert: false
                });
            } catch (e) { }
            return;
        } else if (callbackData === 'rig_mines_always_safe') {
            minesRigMode = 'always_safe';
            await sendTelegramMessage(`💎 Mines: Player luôn an toàn`);
            try {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQueryId,
                    text: '✅ Mines: Luôn safe',
                    show_alert: false
                });
            } catch (e) { }
            return;
        } else if (callbackData === 'set_mines_anti_win') {
            minesRigMode = 'anti_win';
            await sendTelegramMessage(`🔄 Mines: Chế độ bẻ cầu`);
            try {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQueryId,
                    text: '✅ Mines: Anti-Win',
                    show_alert: false
                });
            } catch (e) { }
            return;
        } else if (callbackData === 'set_mines_auto') {
            minesRigMode = 'auto';
            await sendTelegramMessage(`🤖 Mines: Chế độ tự động`);
            try {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQueryId,
                    text: '✅ Mines: Auto',
                    show_alert: false
                });
            } catch (e) { }
            return;

            // === HILO RIG ACTIONS ===
        } else if (callbackData === 'rig_hilo_always_lose') {
            hiloRigMode = 'always_lose';
            await sendTelegramMessage(`❌ Hilo: Player luôn thua`);
            try {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQueryId,
                    text: '✅ Hilo: Luôn thua',
                    show_alert: false
                });
            } catch (e) { }
            return;
        } else if (callbackData === 'rig_hilo_always_win') {
            hiloRigMode = 'always_win';
            await sendTelegramMessage(`✅ Hilo: Player luôn thắng`);
            try {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQueryId,
                    text: '✅ Hilo: Luôn thắng',
                    show_alert: false
                });
            } catch (e) { }
            return;
        } else if (callbackData === 'set_hilo_anti_win') {
            hiloRigMode = 'anti_win';
            await sendTelegramMessage(`🔄 Hilo: Chế độ bẻ cầu`);
            try {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQueryId,
                    text: '✅ Hilo: Anti-Win',
                    show_alert: false
                });
            } catch (e) { }
            return;
        } else if (callbackData === 'set_hilo_auto') {
            hiloRigMode = 'auto';
            await sendTelegramMessage(`🤖 Hilo: Chế độ tự động`);
            try {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQueryId,
                    text: '✅ Hilo: Auto',
                    show_alert: false
                });
            } catch (e) { }
            return;

        } else if (callbackData.startsWith('deposit_approve_')) {
            const depositId = parseInt(callbackData.replace('deposit_approve_', ''));
            console.log(`✅ Xử lý duyệt lệnh nạp #${depositId}`);

            const result = await processDepositAction(depositId, 'approve', 'Telegram Admin');

            // Trả lời callback query ngay để Telegram biết đã nhận
            try {
                const answerUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`;
                await axios.post(answerUrl, {
                    callback_query_id: callbackQueryId,
                    text: result.success ? '✅ Đã duyệt lệnh nạp!' : `❌ ${result.message}`,
                    show_alert: false
                });
            } catch (err) {
                console.error('Lỗi answerCallbackQuery:', err.message);
            }

            // Cập nhật tin nhắn
            if (result.success) {
                try {
                    const editUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`;
                    const originalText = message.text || '';
                    const cleanText = originalText.replace(/\\/g, '').replace(/\*/g, '');
                    const newText = `✅ *ĐÃ DUYỆT*

${cleanText}

_Duyệt bởi: Telegram Admin_`;

                    await axios.post(editUrl, {
                        chat_id: chatId,
                        message_id: message.message_id,
                        text: newText.replace(/-/g, '\\-').replace(/\./g, '\\.').replace(/!/g, '\\!')
                            .replace(/_/g, '\\_').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
                            .replace(/\+/g, '\\+').replace(/=/g, '\\=').replace(/{/g, '\\{')
                            .replace(/}/g, '\\}').replace(/\n/g, '\\n'),
                        parse_mode: 'MarkdownV2'
                    });
                } catch (err) {
                    console.error('Lỗi editMessageText:', err.message);
                }
            }

        } else if (callbackData.startsWith('deposit_reject_')) {
            const depositId = parseInt(callbackData.replace('deposit_reject_', ''));
            console.log(`❌ Xử lý từ chối lệnh nạp #${depositId}`);

            const result = await processDepositAction(depositId, 'reject', 'Telegram Admin');

            // Trả lời callback query ngay để Telegram biết đã nhận
            try {
                const answerUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`;
                await axios.post(answerUrl, {
                    callback_query_id: callbackQueryId,
                    text: result.success ? '❌ Đã từ chối lệnh nạp!' : `❌ ${result.message}`,
                    show_alert: false
                });
            } catch (err) {
                console.error('Lỗi answerCallbackQuery:', err.message);
            }

            // Cập nhật tin nhắn
            if (!result.success) {
                try {
                    const editUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`;
                    const originalText = message.text || '';
                    const cleanText = originalText.replace(/\\/g, '').replace(/\*/g, '');
                    const newText = `❌ *ĐÃ TỪ CHỐI*

${cleanText}

_Từ chối bởi: Telegram Admin_`;

                    await axios.post(editUrl, {
                        chat_id: chatId,
                        message_id: message.message_id,
                        text: newText.replace(/-/g, '\\-').replace(/\./g, '\\.').replace(/!/g, '\\!')
                            .replace(/_/g, '\\_').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
                            .replace(/\+/g, '\\+').replace(/=/g, '\\=').replace(/{/g, '\\{')
                            .replace(/}/g, '\\}').replace(/\n/g, '\\n'),
                        parse_mode: 'MarkdownV2'
                    });
                } catch (err) {
                    console.error('Lỗi editMessageText:', err.message);
                }
            }
        } else {
            console.log(`⚠️ Callback data không nhận dạng được: ${callbackData}`);
            // Trả lời callback để không bị timeout
            try {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQueryId,
                    text: '⚠️ Không nhận dạng được lệnh',
                    show_alert: false
                });
            } catch (e) { }
        }
    } catch (error) {
        console.error('❌ Lỗi xử lý Telegram webhook:', error);
        console.error('Stack:', error.stack);
        // Không trả về lỗi HTTP vì đã trả về ok: true ở đầu
    }
});



// Hằng số cho game Dò Mìn
const TOTAL_TILES = 25;

function generateFakeMines(mineCount, clickedMineIndex, revealedGemIndices) {
    let mines = [clickedMineIndex];
    let availableSlots = [];
    const excludedSlots = [...revealedGemIndices, clickedMineIndex];

    for (let i = 0; i < TOTAL_TILES; i++) {
        if (!excludedSlots.includes(i)) {
            availableSlots.push(i);
        }
    }

    for (let i = availableSlots.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [availableSlots[i], availableSlots[j]] = [availableSlots[j], availableSlots[i]];
    }

    const minesNeeded = Math.min(mineCount - 1, availableSlots.length);
    mines.push(...availableSlots.slice(0, minesNeeded));
    return mines;
}

function nCr(n, k) {
    if (k < 0 || k > n) return 0;
    if (k === 0 || k === n) return 1;
    if (k > n / 2) k = n - k;
    let res = 1;
    for (let i = 1; i <= k; ++i) {
        res = res * (n - i + 1) / i;
    }
    return Math.floor(res);
}

function calculateMinesMultiplier(gemsPicked, mineCount) {
    const gemCount = TOTAL_TILES - mineCount;
    if (gemsPicked > gemCount) return 0;

    const totalCombinations = nCr(TOTAL_TILES, gemsPicked);
    const gemCombinations = nCr(gemCount, gemsPicked);

    if (gemCombinations === 0) return 0;

    const fairMultiplier = totalCombinations / gemCombinations;
    let finalMultiplier = fairMultiplier * (1 - HOUSE_EDGE);
    // Giảm thêm 5% hệ số ở lần mở ô thứ 3 để đồng bộ với client (mines.html)
    if (gemsPicked === 3) {
        finalMultiplier = finalMultiplier * 0.95;
    }
    return parseFloat(finalMultiplier.toFixed(2));
}

function logMinesBet(user, betAmount, profit, multiplier, status, mineCount) {
    const newLog = {
        betId: allData.allBets.length + 1,
        userId: user.id,
        username: user.username,
        betAmount: betAmount,
        betType: `MINES (${mineCount} mìn)`,
        placedAt: new Date().toISOString(),
        status: status, // 'WIN' hoặc 'LOSE'
        payout: profit,
        resultNumber: `x${multiplier.toFixed(2)}`
    };
    allData.allBets.push(newLog);
}

// [THÊM MỚI] HẰNG SỐ VÀ HÀM HELPER CHO HI-LO (Giữ nguyên)
const HILO_GAME_DURATION_MS = 5 * 60 * 1000;
const HOUSE_EDGE = 0.05; // ✅ THÊM HẰNG SỐ QUAN TRỌNG
const SUITS = ['H', 'D', 'C', 'S'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RANK_VALUES = {
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
    'J': 11, 'Q': 12, 'K': 13, 'A': 14
};
function createDeck() {
    let deck = [];
    for (const suit of SUITS) {
        for (const rank of RANKS) {
            deck.push({ rank: rank, suit: suit, value: RANK_VALUES[rank] });
        }
    }
    return deck;
}
function shuffleDeck(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
}
function calculateHiloMultiplier(currentValue, deck) {
    if (!deck || deck.length === 0) {
        return { hiMultiplier: 1.0, loMultiplier: 1.0, highCount: 0, lowCount: 0 };
    }
    let lowCount = 0, highCount = 0, tieCount = 0;
    deck.forEach(card => {
        const val = card.value;
        if (val < currentValue) lowCount++;
        else if (val > currentValue) highCount++;
        else tieCount++;
    });
    const totalRemaining = deck.length;
    const hiMultiplier = (highCount > 0) ? (totalRemaining / highCount) * (1 - HOUSE_EDGE) : 1.0;
    const loMultiplier = (lowCount > 0) ? (totalRemaining / lowCount) * (1 - HOUSE_EDGE) : 1.0;
    return {
        hiMultiplier: parseFloat(hiMultiplier.toFixed(2)),
        loMultiplier: parseFloat(loMultiplier.toFixed(2)), // ✅ SỬA LỖI
        highCount,
        lowCount
    };
}
function logHiloBet(user, betAmount, profit, multiplier, status) {
    const newLog = {
        betId: allData.allBets.length + 1,
        userId: user.id,
        username: user.username,
        betAmount: betAmount,
        betType: `HILO`,
        placedAt: new Date().toISOString(),
        status: status,
        payout: profit,
        resultNumber: `x${multiplier.toFixed(2)}`
    };
    allData.allBets.push(newLog);
}
// KẾT THÚC HELPER HI-LO


const INITIAL_BALANCE = 0.00;
const INITIAL_LIFETIME_DEPOSIT = 0.00;
const INVITE_CODE_LENGTH = 6;
function generateUniqueInviteCode() {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code;
    do {
        code = '';
        for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
            code += characters.charAt(Math.floor(Math.random() * characters.length));
        }
    } while (users.find(u => u.inviteCode === code));
    return code;
}

async function setupInitialData() {
    await loadData();
    if (!users.find(u => u.username === 'admin')) {
        const adminPasswordHash = await bcrypt.hash('123456', 10);
        users.push({
            id: nextUserId++,
            username: 'admin',
            passwordHash: adminPasswordHash,
            isAdmin: true,
            balance: 999999.00,
            vipLevel: 10,
            lifetimeDeposit: 1000000,
            phone: '0901234567',
            fullName: 'Admin Root',
            isNameVerified: true, // [SỬA] Admin tự verify
            email: 'admin@coinvid.vn',
            fundPasswordHash: adminPasswordHash,
            depositLimits: [],
            inviteCode: generateUniqueInviteCode(),
            invitedBy: null,
            createdAt: new Date().toISOString(),
            minesLossStreak: 0,
            minesProfitRate: 0,
            boProfit: 0,
            wheelSpins: 999,
            kycStatus: 'VERIFIED', // [MỚI]
            kycSubmission: { // [MỚI]
                fullName: 'Admin Root', idNumber: '000000000',
                photo1: 'mock.jpg', photo2: 'mock.jpg'
            }
        });
        const testPasswordHash = await bcrypt.hash('123456', 10);
        users.push({
            id: nextUserId++,
            username: 'testuser',
            passwordHash: testPasswordHash,
            isAdmin: false,
            balance: 100.00,
            vipLevel: 1,
            lifetimeDeposit: 0,
            phone: '0901234568',
            fullName: '', // [SỬA]
            isNameVerified: false, // [SỬA]
            email: 'test@mail.com',
            fundPasswordHash: null,
            depositLimits: [],
            inviteCode: generateUniqueInviteCode(),
            invitedBy: null,
            createdAt: new Date().toISOString(),
            minesLossStreak: 0,
            minesProfitRate: 0,
            boProfit: 0,
            wheelSpins: 5,
            kycStatus: 'NOT_SUBMITTED', // [MỚI]
            kycSubmission: {} // [MỚI]
        });
        await saveData();
    }
}
function calculateVipLevel(lifetimeDeposit) {
    if (lifetimeDeposit >= 800000) return 9;
    if (lifetimeDeposit >= 300000) return 8;
    if (lifetimeDeposit >= 100000) return 7;
    if (lifetimeDeposit >= 15000) return 6;
    if (lifetimeDeposit >= 5000) return 5;
    if (lifetimeDeposit >= 800) return 4;
    if (lifetimeDeposit >= 100) return 3;
    if (lifetimeDeposit >= 2) return 2;
    return 1;
}
function getNextVipTarget(currentVip) {
    const vipTargets = {
        0: 2, 1: 100, 2: 800, 3: 5000, 4: 15000,
        5: 100000, 6: 300000, 7: 800000, 8: 10000000, 9: 0,
    };
    return vipTargets[currentVip] || 0;
}

// **********************************************
// CẤU HÌNH VIP: PHÍ RÚT VÀ QUYỀN LỢI
// **********************************************
const VIP_WITHDRAW_FEES = {
    1: 0.03, 2: 0.028, 3: 0.025, 4: 0.02, 5: 0.015,
    6: 0.01, 7: 0.008, 8: 0.005, 9: 0.003, 10: 0.001,
};
const VIP_BENEFITS = {
    1: ["Hỗ trợ cơ bản 24/7", "Phí rút tiền 3.0%"],
    2: ["Hỗ trợ ưu tiên", "Phí rút tiền 2.8%", "Ưu đãi nạp USDT 0.5%"],
    3: ["Quản lý tài khoản chuyên biệt", "Phí rút tiền 2.5%", "Ưu đãi nạp USDT 1.0%", "Thưởng sinh nhật"],
    4: ["Thưởng thăng cấp 20 USDT", "Phí rút tiền 2.0%", "Hạn mức rút tiền cao hơn"],
    5: ["Thưởng thăng cấp 50 USDT", "Phí rút tiền 1.5%", "Quà tặng sự kiện độc quyền"],
    6: ["Thưởng thăng cấp 200 USDT", "Phí rút tiền 1.0%", "Tăng tỉ lệ hoàn trả cược"],
    7: ["Thưởng thăng cấp 500 USDT", "Phí rút tiền 0.8%", "Ưu tiên rút tiền siêu tốc"],
    8: ["Thưởng thăng cấp 2000 USDT", "Phí rút tiền 0.5%", "Tham gia giải đấu VIP"],
    9: ["Thưởng thăng cấp 5000 USDT", "Phí rút tiền 0.3%", "Được mời tham gia các sự kiện ngoại tuyến"],
    10: ["Thưởng thăng cấp 10000 USDT", "Phí rút tiền 0.1%", "Quản lý cá nhân 1:1, Quà tặng đặc biệt hàng năm"],
};

// [SỬA] Hàm lấy phí rút tiền (ưu tiên cài đặt admin)
function getWithdrawFeeRate(vipLevel) {
    // Ưu tiên 1: Lấy phí toàn cục từ Admin setting
    const globalFee = allData.settings.withdrawFee;
    if (globalFee !== undefined && globalFee >= 0) {
        return globalFee / 100; // Admin set 1 (%), trả về 0.01
    }

    // Ưu tiên 2 (Fallback): Dùng phí theo VIP (logic cũ)
    const level = parseInt(vipLevel) || 1;
    return VIP_WITHDRAW_FEES[level] || VIP_WITHDRAW_FEES[1];
}

function findUser(key, value) {
    if (key === 'email' && typeof value === 'string') {
        return users.find(u => u.email && u.email.toLowerCase() === value.toLowerCase());
    }
    // [SỬA LỖI] So sánh ID dạng số
    if (key === 'id') {
        const numericValue = parseInt(value);
        return users.find(u => u.id === numericValue);
    }
    return users.find(u => u[key] === value);
}

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'Không có token truy cập.' });
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return res.status(403).json({ message: 'Token không hợp lệ hoặc đã hết hạn.' });
        const user = findUser('id', decoded.userId);
        if (!user) return res.status(404).json({ message: 'Người dùng không tồn tại.' });
        req.user = user;
        next();
    });
};
const adminRateLimit = new Map();
const authenticateAdmin = (req, res, next) => {
    if (!req.user.isAdmin) {
        return res.status(403).json({ message: 'Bạn không có quyền Admin.' });
    }
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const windowMs = 60000;
    const maxRequests = 100;
    if (!adminRateLimit.has(ip)) {
        adminRateLimit.set(ip, { count: 1, resetTime: now + windowMs });
    } else {
        const limit = adminRateLimit.get(ip);
        if (now > limit.resetTime) {
            limit.count = 1;
            limit.resetTime = now + windowMs;
        } else {
            limit.count++;
            if (limit.count > maxRequests) {
                return res.status(429).json({ message: 'Quá nhiều yêu cầu. Vui lòng thử lại sau.' });
            }
        }
    }
    next();
};

// **********************************************
// API ROUTES (Giữ nguyên)
// **********************************************
app.get('/api/user/invite-data', authenticateToken, (req, res) => {
    const user = req.user;
    const directReferrals = users.filter(u => u.invitedBy === user.id);
    const directReferralIds = directReferrals.map(u => u.id);
    const secondLevelReferrals = users.filter(u => directReferralIds.includes(u.invitedBy));
    const secondLevelReferralsIds = secondLevelReferrals.map(u => u.id);
    const thirdLevelReferrals = users.filter(u => secondLevelReferrals.includes(u.invitedBy));
    const totalReferrals = directReferrals.length;
    const activeF1 = directReferrals.filter(u => u.lifetimeDeposit > 0);
    const totalActiveF1 = activeF1.length;
    const totalF2 = secondLevelReferrals.length;
    const totalF3 = thirdLevelReferrals.length;
    const totalF1Deposit = directReferrals.reduce((sum, u) => sum + u.lifetimeDeposit, 0);
    const totalF2Deposit = secondLevelReferrals.reduce((sum, u) => sum + u.lifetimeDeposit, 0);
    const mockRebate = totalF1Deposit * 0.0005 + totalF2Deposit * 0.0001;
    const currentLevel = 1;
    const nextTargetCount = 10;
    const nextLevel = currentLevel + 1;
    const mockTeamData = {
        F1: directReferrals.map(u => ({
            username: u.username,
            deposit: u.lifetimeDeposit.toFixed(2),
            status: u.lifetimeDeposit > 0 ? 'Active' : 'Inactive',
            lastLogin: new Date(Date.now() - Math.random() * 86400000 * 7).toLocaleDateString('vi-VN'),
        })).slice(0, 20),
        F2: secondLevelReferrals.map(u => ({
            username: u.username,
            deposit: u.lifetimeDeposit.toFixed(2),
            status: u.lifetimeDeposit > 0 ? 'Active' : 'Inactive',
        })).slice(0, 20),
    };
    const mockReportData = [];
    for (let i = 0; i < 7; i++) {
        mockReportData.push({
            date: new Date(Date.now() - i * 86400000).toLocaleDateString('vi-VN'),
            rebate: (Math.random() * 5 + 1).toFixed(4),
            deposit_f1: (Math.random() * 100 + 10).toFixed(2),
            bet_f1: (Math.random() * 500 + 100).toFixed(2),
        });
    }
    res.json({
        inviteCode: user.inviteCode, currentLevel: currentLevel, nextLevel: nextLevel,
        nextTargetCount: nextTargetCount, currentProgressCount: totalActiveF1,
        totalRebate: mockRebate, subLevel1Active: totalActiveF1,
        subLevel1Total: totalReferrals, subLevel2Total: totalF2, subLevel3Total: totalF3,
        teamData: mockTeamData, reportData: mockReportData,
    });
});

// Sửa tất cả các route trỏ file HTML (nếu có)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// [SỬA] API Tỷ giá (dùng getActiveRate)
app.get('/api/wallet/exchange-rate', async (req, res) => {
    try {
        const finalRate = getActiveRate();
        const isManual = manualUsdToVndRate > 0;
        res.json({
            rate: finalRate,
            source: isManual ? `Thủ công (${finalRate.toFixed(0)})` : `Live (${liveUsdToVndRate.toFixed(0)})`,
            lastUpdate: isManual ? new Date() : lastRateUpdate
        });
    } catch (error) {
        res.status(500).json({ message: 'Không thể lấy tỷ giá.', rate: liveUsdToVndRate });
    }
});
// [SỬA] API Tỷ giá (dùng getActiveRate)
app.get('/api/wallet/deposit-rate', async (req, res) => {
    try {
        const finalRate = getActiveRate();
        const isManual = manualUsdToVndRate > 0;
        res.json({
            rate: finalRate,
            source: isManual ? `Thủ công (${finalRate.toFixed(0)})` : `Live (${liveUsdToVndRate.toFixed(0)})`,
            lastUpdate: isManual ? new Date() : lastRateUpdate
        });
    } catch (error) {
        res.status(500).json({ message: 'Không thể lấy tỷ giá.', rate: liveUsdToVndRate });
    }
});


app.get('/api/user/vip-info', authenticateToken, (req, res) => {
    const vipLevel = req.user.vipLevel;
    const withdrawFee = getWithdrawFeeRate(vipLevel);
    res.json({
        vipLevel: vipLevel, withdrawFeeRate: withdrawFee,
        vipBenefits: VIP_BENEFITS, vipFeeList: VIP_WITHDRAW_FEES
    });
});
app.post('/api/auth/register', async (req, res) => {
    const { username, password, email, inviteCode } = req.body;
    if (!username || !password || !email) {
        return res.status(400).json({ message: 'Thiếu thông tin bắt buộc.' });
    }
    if (findUser('username', username)) {
        return res.status(400).json({ message: 'Tên đăng nhập đã tồn tại.' });
    }
    if (email && findUser('email', email)) {
        return res.status(400).json({ message: 'Địa chỉ email này đã được sử dụng.' });
    }
    let invitedByUserId = null;
    if (inviteCode) {
        const inviter = findUser('inviteCode', inviteCode);
        if (inviter) {
            invitedByUserId = inviter.id;
        } else {
        }
    }
    const passwordHash = await bcrypt.hash(password, 10);
    // [SỬA] Thêm trường KYC
    const newUser = {
        id: nextUserId++,
        username, passwordHash, isAdmin: false,
        balance: INITIAL_BALANCE, vipLevel: 0, lifetimeDeposit: INITIAL_LIFETIME_DEPOSIT,
        phone: '', fullName: '', isNameVerified: false,
        email: email.toLowerCase(),
        fundPasswordHash: null, depositLimits: [],
        inviteCode: generateUniqueInviteCode(),
        invitedBy: invitedByUserId,
        createdAt: new Date().toISOString(),
        minesLossStreak: 0, minesProfitRate: 0,
        boProfit: 0, wheelSpins: 1,
        kycStatus: 'NOT_SUBMITTED', // [MỚI]
        kycSubmission: {} // [MỚI]
    };
    users.push(newUser);
    await saveData();
    const token = jwt.sign({ userId: newUser.id }, JWT_SECRET, { expiresIn: '24h' });
    res.status(201).json({ token, user: { username: newUser.username, isAdmin: newUser.isAdmin } });
});
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    const user = findUser('username', username);
    if (!user) {
        return res.status(401).json({ message: 'Tên đăng nhập hoặc mật khẩu không đúng.' });
    }
    let isMatch = false;
    if (user.passwordHash) {
        isMatch = await bcrypt.compare(password, user.passwordHash);
    }
    if (!isMatch) {
        return res.status(401).json({ message: 'Tên đăng nhập hoặc mật khẩu không đúng.' });
    }

    // [MỚI] Thêm kiểm tra bảo trì cho admin khi đăng nhập
    if (isMaintenanceMode && !user.isAdmin) {
        return res.status(503).json({ message: 'Hệ thống đang bảo trì, vui lòng quay lại sau.' });
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, user: { username: user.username, isAdmin: user.isAdmin } });
});
app.post('/api/auth/forgot-password', async (req, res) => {
    const { identifier } = req.body;
    if (!identifier) return res.status(400).json({ message: 'Thiếu thông tin.' });
    const user = users.find(u =>
        u.username.toLowerCase() === identifier.toLowerCase() ||
        (u.email && u.email.toLowerCase() === identifier.toLowerCase())
    );
    const successMsg = 'Nếu tài khoản tồn tại, hướng dẫn đã được gửi.';
    if (!user || !user.email) {
        return res.json({ message: successMsg });
    }
    const resetToken = crypto.randomBytes(20).toString('hex');
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = Date.now() + 3600000; // 1 giờ
    await saveData();
    const resetLink = `http://coinwit.net:3000/reset-password.html?token=${resetToken}`;
    const mailOptions = {
        from: '"CoinWit Support" no-reply@coinwit.net',
        to: user.email,
        subject: '[CoinWit] Yêu cầu đặt lại mật khẩu',
        html: `
            <div style="font-family: Arial, sans-serif; line-height: 1.6;">
                <h2>Xin chào ${user.username},</h2>
                <p>Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn trên CoinWit.</p>
                <p>Vui lòng nhấp vào nút bên dưới để đặt mật khẩu mới. Liên kết này sẽ hết hạn sau 1 giờ.</p>
                <a href="${resetLink}" style="display: inline-block; padding: 12px 25px; margin: 20px 0; font-size: 16px; font-weight: bold; color: #111; background-color: #facc15; text-decoration: none; border-radius: 5px;">
                    Đặt Lại Mật Khẩu
                </a>
                <p>Nếu bạn không thể nhấp vào nút, vui lòng sao chép và dán liên kết sau vào trình duyệt:</p>
                <p>${resetLink}</p>
                <p>Nếu bạn không yêu cầu điều này, vui lòng bỏ qua email.</p>
            </div>
        `
    };
    try {
        await transporter.sendMail(mailOptions);
    } catch (error) {
    }
    res.json({ message: successMsg });
});
app.post('/api/auth/reset-password', async (req, res) => {
    const { token, newPassword } = req.body;
    const user = users.find(u =>
        u.resetPasswordToken === token &&
        u.resetPasswordExpires > Date.now()
    );
    if (!user) {
        return res.status(400).json({ message: 'Token không hợp lệ hoặc đã hết hạn.' });
    }
    if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ message: 'Mật khẩu phải có ít nhất 6 ký tự.' });
    }
    const salt = await bcrypt.genSalt(10);
    user.passwordHash = await bcrypt.hash(newPassword, salt);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await saveData();
    res.json({ message: 'Mật khẩu đã được thay đổi thành công.' });
});
// Dán đoạn code này để THAY THẾ TOÀN BỘ hàm cũ (từ dòng 740 đến 786)

app.post('/api/wallet/create-deposit-order', authenticateToken, async (req, res) => {
    const { amountVND, channelName } = req.body;
    const user = req.user;

    if (typeof amountVND !== 'number' || amountVND <= 0 || !channelName) {
        return res.status(400).json({ message: 'Dữ liệu nạp không hợp lệ (Số tiền hoặc Kênh nạp).' });
    }

    // --- [SỬA LỖI SPAM] ---
    // 1. Định nghĩa giới hạn
    const PENDING_LIMIT = 5;
    const TEN_MINUTES_MS = 10 * 60 * 1000; // 10 phút
    const tenMinutesAgo = Date.now() - TEN_MINUTES_MS;

    // 2. Lọc các lệnh đang chờ (PENDING) trong 10 phút qua của user này
    const pendingDepositsInWindow = allData.deposits.filter(d =>
        d.userId === user.id &&
        d.status === 'PENDING' &&
        new Date(d.createdAt).getTime() > tenMinutesAgo
    );

    // 3. Kiểm tra
    if (pendingDepositsInWindow.length >= PENDING_LIMIT) {
        return res.status(429).json({
            message: `Bạn có ${pendingDepositsInWindow.length} lệnh nạp đang chờ. Vui lòng chờ lệnh được xử lý hoặc thử lại sau 10 phút.`
        });
    }
    // --- [KẾT THÚC SỬA LỖI] ---

    // [SỬA] Dùng getActiveRate
    const baseRate = getActiveRate();
    const amountUSDT = amountVND / baseRate;

    // *** ĐÃ XÓA LOGIC user.depositLimits CŨ ***

    const accountInfo = getNextAccount(channelName);
    if (!accountInfo) {
        return res.status(500).json({ message: 'Kênh nạp tiền không hợp lệ hoặc đang bảo trì.' });
    }

    const depositId = nextDepositId++;
    const paymentContent = `CW${depositId}${user.id}`;

    const newDeposit = {
        id: depositId, userId: user.id, username: user.username,
        amount: parseFloat(amountUSDT.toFixed(4)),
        amountVND: amountVND, rateUsed: baseRate,
        channelName: channelName, status: 'PENDING',
        paymentInfo: {
            bank: accountInfo.bank,
            account: accountInfo.account,
            accountName: accountInfo.name, // ĐÃ SỬA TỪ LỖI TRƯỚC
            content: paymentContent,
        },
        createdAt: new Date().toISOString()
    };

    allData.deposits.push(newDeposit);

    // *** ĐÃ XÓA LOGIC user.depositLimits.push(now) CŨ ***

    await saveData();

    sendTelegramMessage(`*LỆNH NẠP MỚI*
User: ${user.username} (ID: ${user.id})
Số tiền: ${amountVND.toLocaleString('vi-VN')} VND
Kênh: ${channelName}
Nội dung: ${paymentContent}`, depositId);
    io.emit('new_deposit', newDeposit);

    res.json({
        message: 'Lệnh nạp đã được tạo thành công.',
        depositId: newDeposit.id, amountVND: amountVND,
        amountUSDT: newDeposit.amount, rateUsed: baseRate,
        paymentInfo: newDeposit.paymentInfo,
        createdAt: new Date().toISOString()
    });
});
const CRYPTO_NETWORK_FEE = 1;
app.post('/api/wallet/withdraw', authenticateToken, async (req, res) => {
    const { amount, fundPassword } = req.body;
    const user = req.user;

    // [SỬA] Kiểm tra KYC dựa trên Cài đặt Admin
    if (allData.settings.requireKyc && user.kycStatus !== 'VERIFIED') {
        return res.status(400).json({ message: 'Vui lòng xác minh KYC trước khi rút tiền.' });
    }
    if (!user.bankName || !user.accountNumber) {
        return res.status(400).json({ message: 'Vui lòng liên kết thẻ ngân hàng trước khi rút tiền.' });
    }
    const withdrawFeeRate = getWithdrawFeeRate(user.vipLevel);
    const amountToReceiveUSDT = parseFloat(amount);
    if (isNaN(amountToReceiveUSDT)) {
        return res.status(400).json({ message: 'Số tiền không hợp lệ.' });
    }
    if (amountToReceiveUSDT < 7) {
        return res.status(400).json({ message: 'Số tiền thực nhận tối thiểu phải tương đương 7 USDT (khoảng 200.000 VND).' });
    }
    const totalWithdrawAmountUSDT = amountToReceiveUSDT / (1 - withdrawFeeRate);
    if (totalWithdrawAmountUSDT > user.balance) {
        return res.status(400).json({ message: `Số dư không đủ. Cần ${totalWithdrawAmountUSDT.toFixed(4)} USDT (bao gồm phí ${Math.round(withdrawFeeRate * 100)}%).` });
    }
    if (!user.fundPasswordHash || !(await bcrypt.compare(fundPassword, user.fundPasswordHash))) {
        return res.status(400).json({ message: 'Mật khẩu quỹ không đúng.' });
    }
    user.balance = parseFloat((user.balance - totalWithdrawAmountUSDT).toFixed(4));
    const feeUSDT = totalWithdrawAmountUSDT - amountToReceiveUSDT;
    const newWithdrawal = {
        id: nextWithdrawalId++, userId: user.id, username: user.username,
        amount: amountToReceiveUSDT, fee: feeUSDT, feeRate: withdrawFeeRate,
        vipLevel: user.vipLevel, type: 'FIAT', status: 'PENDING',
        bankInfo: `${user.bankName} (${user.accountNumber})`,
        createdAt: new Date().toISOString()
    };
    allData.withdrawals.push(newWithdrawal);
    await saveData();
    sendTelegramMessage(`*LỆNH RÚT FIAT MỚI*\nUser: ${user.username} (ID: ${user.id})\nThực nhận: ${amountToReceiveUSDT} USDT\nPhí: ${feeUSDT.toFixed(4)} USDT (VIP ${user.vipLevel}, ${Math.round(withdrawFeeRate * 100)}%)`);
    res.json({
        message: 'Yêu cầu rút đã được gửi thành công.',
        newBalance: user.balance, withdrawalId: newWithdrawal.id,
        feeRate: withdrawFeeRate
    });
});
app.post('/api/wallet/withdraw-crypto', authenticateToken, async (req, res) => {
    const { amount, fundPassword, walletAddress } = req.body;
    const user = req.user;
    const totalWithdrawAmount = parseFloat(amount);
    if (isNaN(totalWithdrawAmount)) {
        return res.status(400).json({ message: 'Số tiền rút không hợp lệ.' });
    }
    const amountToReceive = totalWithdrawAmount - CRYPTO_NETWORK_FEE;
    if (amountToReceive < 10) {
        return res.status(400).json({ message: 'Số tiền thực nhận phải ít nhất 10 USDT (tổng rút tối thiểu 11 USDT).' });
    }
    if (!walletAddress || !(walletAddress.startsWith('T') || walletAddress.startsWith('0x'))) {
        return res.status(400).json({ message: 'Địa chỉ ví không hợp lệ. Chỉ hỗ trợ TRC20 (bắt đầu bằng T) hoặc ERC20 (bắt đầu bằng 0x).' });
    }
    if (!user.fundPasswordHash || !(await bcrypt.compare(fundPassword, user.fundPasswordHash))) {
        return res.status(400).json({ message: 'Mật khẩu quỹ không đúng.' });
    }
    if (totalWithdrawAmount > user.balance) {
        return res.status(400).json({ message: `Số dư không đủ. Cần ${totalWithdrawAmount.toFixed(2)} USDT để rút.'}` });
    }
    user.balance = parseFloat((user.balance - totalWithdrawAmount).toFixed(4));
    const newWithdrawal = {
        id: nextWithdrawalId++, userId: user.id, username: user.username,
        amount: amountToReceive, fee: CRYPTO_NETWORK_FEE,
        type: 'CRYPTO', status: 'PENDING',
        bankInfo: walletAddress, createdAt: new Date().toISOString()
    };
    allData.withdrawals.push(newWithdrawal);
    await saveData();
    sendTelegramMessage(`*LỆNH RÚT CRYPTO MỚI*
User: ${user.username} (ID: ${user.id})
Tổng rút: ${totalWithdrawAmount} USDT
Thực nhận: ${amountToReceive} USDT
Ví: ${walletAddress}`);
    res.json({ message: 'Yêu cầu rút Crypto đã được gửi thành công.', newBalance: user.balance, withdrawalId: newWithdrawal.id });
});

// THAY THẾ TOÀN BỘ HÀM /api/wallet/bind-card (dòng 922) BẰNG CODE NÀY

app.post('/api/wallet/bind-card', authenticateToken, async (req, res) => {
    // [SỬA] Lấy bankCode từ body (file html của bạn có gửi)
    const { bankName, accountNumber, fullName, bankCode } = req.body;
    const user = req.user;

    if (!bankName || !accountNumber || !fullName || !bankCode) {
        return res.status(400).json({ message: 'Vui lòng điền đủ thông tin (Ngân hàng, STK, Họ tên).' });
    }

    // [LOGIC MỚI] Ghi Tên và cờ xác minh.
    // Tên thật sẽ được ĐỒNG BỘ với thẻ ngân hàng.
    // Logic 24h/chỉnh sửa đã được xử lý ở client (bind_card.html)

    user.fullName = fullName.toUpperCase(); // Đảm bảo IN HOA
    user.bankName = bankName;
    user.accountNumber = accountNumber;
    user.bankCode = bankCode; // [SỬA] Lưu cả bankCode
    user.isNameVerified = true; // <-- [SỬA LỖI] THÊM DÒNG NÀY ĐỂ KHÓA FORM

    await saveData();

    // Ghi log hành động
    await logAdminAction(user.username, user.id, `Liên kết thẻ ngân hàng & Xác minh tên: ${fullName}`);

    res.json({
        message: 'Cập nhật thẻ và xác minh tên thật thành công.',
        fullName: user.fullName
    });
});

app.post('/api/settings/fund-password', authenticateToken, async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    const user = req.user;
    if (newPassword.length < 6) { return res.status(400).json({ message: 'Mật khẩu quỹ phải có ít nhất 6 ký tự.' }); }
    if (user.fundPasswordHash) {
        if (!oldPassword) { return res.status(400).json({ message: 'Vui lòng nhập mật khẩu quỹ cũ.' }); }
        const isOldPasswordCorrect = await bcrypt.compare(oldPassword, user.fundPasswordHash);
        if (!isOldPasswordCorrect) { return res.status(400).json({ message: 'Mật khẩu quỹ cũ không đúng.' }); }
    }
    const salt = await bcrypt.genSalt(10);
    user.fundPasswordHash = await bcrypt.hash(newPassword, salt);
    await saveData();
    res.json({ message: 'Mật khẩu quỹ đã được cập nhật thành công.' });
});
app.post('/api/settings/change-password', authenticateToken, async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    const user = req.user;
    if (newPassword.length < 6) { return res.status(400).json({ message: 'Mật khẩu mới phải có ít nhất 6 ký tự.' }); }
    if (newPassword === oldPassword) { return res.status(400).json({ message: 'Mật khẩu mới không được giống mật khẩu cũ.' }); }
    let isOldPasswordCorrect = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!isOldPasswordCorrect) { return res.status(400).json({ message: 'Mật khẩu đăng nhập cũ không đúng.' }); }
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);
    user.passwordHash = hashedPassword;
    await saveData();
    res.json({ message: 'Mật khẩu đăng nhập đã được thay đổi thành công.' });
});
app.post('/api/settings/set-email', authenticateToken, async (req, res) => {
    const { email } = req.body;
    if (!email || !email.includes('@')) { return res.status(400).json({ message: 'Email không hợp lệ.' }); }
    if (users.find(u => u.email === email && u.id !== req.user.id)) {
        return res.status(400).json({ message: 'Địa chỉ email này đã được sử dụng.' });
    }
    const user = users.find(u => u.id === req.user.id);
    user.email = email;
    await saveData();
    res.json({ message: 'Địa chỉ thư (email) đã được gắn thành công.' });
});
app.post('/api/settings/change-phone', authenticateToken, async (req, res) => {
    const { newPhone } = req.body;
    if (!newPhone || newPhone.length < 10) { return res.status(400).json({ message: 'Số điện thoại không hợp lệ.' }); }
    if (users.find(u => u.phone === newPhone && u.id !== req.user.id)) {
        return res.status(400).json({ message: 'Số điện thoại này đã được sử dụng bởi người dùng khác.' });
    }
    const user = users.find(u => u.id === req.user.id);
    user.phone = newPhone;
    await saveData();
    res.json({ message: 'Số điện thoại đã được thay đổi thành công.' });
});
app.get('/api/admin/summary', authenticateToken, authenticateAdmin, (req, res) => {
    const totalUsers = users.length;
    const totalBalance = users.reduce((sum, u) => sum + u.balance, 0);
    const pendingDeposits = allData.deposits.filter(d => d.status === 'PENDING').length;
    const pendingWithdrawals = allData.withdrawals.filter(w => w.status === 'PENDING').length;
    res.json({
        totalUsers,
        totalBalance: parseFloat(totalBalance.toFixed(2)),
        pendingDeposits,
        pendingWithdrawals
    });
});
app.get('/api/admin/users', authenticateToken, authenticateAdmin, (req, res) => {
    const safeUsers = users.map(u => ({
        id: u.id, username: u.username, isAdmin: u.isAdmin,
        balance: u.balance, vipLevel: u.vipLevel, lifetimeDeposit: u.lifetimeDeposit,
        createdAt: u.createdAt, isNameVerified: u.isNameVerified,
        phone: u.phone, email: u.email, inviteCode: u.inviteCode, invitedBy: u.invitedBy,
        kycStatus: u.kycStatus || 'NOT_SUBMITTED' // [MỚI]
    }));
    res.json(safeUsers);
});
app.get('/api/admin/deposits', authenticateToken, authenticateAdmin, (req, res) => {
    const sortedDeposits = allData.deposits.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(sortedDeposits);
});
app.get('/api/admin/withdrawals', authenticateToken, authenticateAdmin, (req, res) => {
    const sortedWithdrawals = allData.withdrawals.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(sortedWithdrawals);
});
// Helper function để xử lý deposit (dùng chung cho API và Telegram)
async function processDepositAction(depositId, action, adminUsername = 'Telegram Bot') {
    const deposit = allData.deposits.find(d => d.id === depositId);
    if (!deposit) {
        return { success: false, message: 'Không tìm thấy lệnh nạp.' };
    }
    if (deposit.status !== 'PENDING') {
        return { success: false, message: `Lệnh đã được xử lý (${deposit.status}).` };
    }
    const user = findUser('id', deposit.userId);
    if (!user) {
        deposit.status = 'FAILED';
        await saveData();
        return { success: false, message: 'Người dùng không tồn tại.' };
    }

    if (action === 'approve') {
        user.balance = parseFloat((user.balance + deposit.amount).toFixed(4));
        user.lifetimeDeposit = parseFloat((user.lifetimeDeposit + deposit.amount).toFixed(4));
        user.vipLevel = calculateVipLevel(user.lifetimeDeposit);

        const MIN_VND_FOR_SPIN = 50000;
        if (deposit.amountVND >= MIN_VND_FOR_SPIN) {
            if (user.wheelSpins === undefined) user.wheelSpins = 0;
            user.wheelSpins += 1;
            io.to(`user_${user.id}`).emit('wheel_spins_updated', { newSpins: user.wheelSpins });
        }

        deposit.status = 'APPROVED';
        deposit.processedAt = new Date().toISOString();
        await logAdminAction(adminUsername, user.id, `Duyệt lệnh nạp #${depositId} (VND ${deposit.amountVND})`);
        await saveData();
        io.to(`user_${user.id}`).emit('deposit_approved', {
            depositId: deposit.id,
            amount: deposit.amount
        });
        return { success: true, message: 'Duyệt lệnh nạp thành công!', newBalance: user.balance };
    }
    if (action === 'reject') {
        deposit.status = 'REJECTED';
        deposit.processedAt = new Date().toISOString();
        await logAdminAction(adminUsername, user.id, `Từ chối lệnh nạp #${depositId}`);
        await saveData();
        io.to(`user_${user.id}`).emit('deposit_rejected', {
            depositId: deposit.id
        });
        return { success: true, message: 'Lệnh nạp đã bị từ chối.', deposit };
    }
    return { success: false, message: 'Hành động không hợp lệ.' };
}

app.post('/api/admin/deposits/process', authenticateToken, authenticateAdmin, async (req, res) => {
    const depositId = parseInt(req.body.depositId);
    const { action } = req.body;
    const result = await processDepositAction(depositId, action, req.user.username);
    if (result.success) {
        return res.json({ message: result.message, newBalance: result.newBalance });
    } else {
        return res.status(400).json({ message: result.message });
    }
});

// Webhook endpoint đã được di chuyển lên trên (trước checkMaintenance)
app.post('/api/admin/withdrawals/process', authenticateToken, authenticateAdmin, async (req, res) => {
    const withdrawalId = parseInt(req.body.withdrawalId);
    const { action } = req.body;
    const withdrawal = allData.withdrawals.find(w => w.id === withdrawalId);
    if (!withdrawal) { return res.status(404).json({ message: 'Không tìm thấy lệnh rút.' }); }
    if (withdrawal.status !== 'PENDING') { return res.status(400).json({ message: `Lệnh đã được xử lý (${withdrawal.status}).` }); }
    const user = findUser('id', withdrawal.userId);
    if (!user) { withdrawal.status = 'FAILED'; await saveData(); return res.status(404).json({ message: 'Người dùng không tồn tại.' }); }
    if (action === 'approve') {
        withdrawal.status = 'APPROVED';
        withdrawal.processedAt = new Date().toISOString();
        // [MỚI] Ghi log
        await logAdminAction(req.user.username, user.id, `Duyệt lệnh rút #${withdrawalId} (${withdrawal.amount} USDT)`);
        await saveData();
        return res.json({ message: `Duyệt lệnh rút ID ${withdrawalId} thành công!` });
    }
    if (action === 'reject') {
        const fee = withdrawal.fee || 0;
        const totalRefundAmount = withdrawal.amount + fee;
        user.balance = parseFloat((user.balance + totalRefundAmount).toFixed(4));
        withdrawal.status = 'REJECTED';
        withdrawal.processedAt = new Date().toISOString();
        // [MỚI] Ghi log
        await logAdminAction(req.user.username, user.id, `Từ chối lệnh rút #${withdrawalId} (Hoàn ${totalRefundAmount} USDT)`);
        await saveData();
        return res.json({ message: `Lệnh rút ID ${withdrawalId} đã bị từ chối và hoàn tiền ${totalRefundAmount} USDT thành công.`, newBalance: user.balance });
    }
    return res.status(400).json({ message: 'Hành động không hợp lệ.' });
});
app.post('/api/admin/adjust-balance', authenticateToken, authenticateAdmin, async (req, res) => {
    const { userId, amount, reason } = req.body;
    const targetUserId = parseInt(userId);
    const amountFloat = parseFloat(amount);
    if (isNaN(targetUserId) || isNaN(amountFloat) || amountFloat === 0) {
        return res.status(400).json({ message: 'Dữ liệu không hợp lệ (UserID hoặc Amount).' });
    }
    const user = findUser('id', targetUserId);
    if (!user) {
        return res.status(404).json({ message: 'Không tìm thấy người dùng.' });
    }
    const action = amountFloat > 0 ? 'ADD' : 'SUBTRACT';
    const absoluteAmount = Math.abs(amountFloat);
    if (action === 'SUBTRACT' && user.balance < absoluteAmount) {
        return res.status(400).json({ message: 'Số dư không đủ để trừ.' });
    }
    user.balance = parseFloat((user.balance + amountFloat).toFixed(4));
    let newLifetimeDeposit = user.lifetimeDeposit;
    if (action === 'ADD') {
        user.lifetimeDeposit = parseFloat((user.lifetimeDeposit + absoluteAmount).toFixed(4));
        user.vipLevel = calculateVipLevel(user.lifetimeDeposit);
        newLifetimeDeposit = user.lifetimeDeposit;
    }
    const reasonText = reason ? ` (Lý do: ${reason})` : '';
    // [MỚI] Ghi log
    await logAdminAction(req.user.username, user.id, `${action === 'ADD' ? 'Cộng' : 'Trừ'} ${absoluteAmount} USDT. ${reasonText}`);
    await saveData();
    sendTelegramMessage(`*ADMIN ĐIỀU CHỈNH SỐ DƯ*\nUser: ${user.username} (ID: ${user.id})\n${action === 'ADD' ? 'Cộng' : 'Trừ'}: ${absoluteAmount} USDT${reasonText}\nSố dư mới: ${user.balance.toFixed(4)} USDT`);
    return res.json({
        message: `${action === 'ADD' ? 'Cộng' : 'Trừ'} ${absoluteAmount} USDT thành công.`,
        newBalance: user.balance,
        newLifetimeDeposit: newLifetimeDeposit
    });
});

// [SỬA] API can thiệp game 40S (1-20)
app.post('/api/admin/game-control', authenticateToken, authenticateAdmin, async (req, res) => {
    const { mode, type, value } = req.body;
    if (mode === 'auto') {
        next_40S_Intervention = null;
        return res.json({ message: 'Đã chuyển game về chế độ Tự động (Casino).' });
    }
    if (mode === 'anti-majority') {
        next_40S_Intervention = { mode: 'anti-majority' };
        return res.json({ message: 'Đã BẬT chế độ Bẻ Cầu (kết quả về bên cược ít nhất).' });
    }
    if (mode === 'manual') {
        if (!type || !value) {
            return res.status(400).json({ message: 'Lỗi: Vui lòng cung cấp Loại can thiệp (type) và Giá trị (value).' });
        }
        if (type !== 'setNumber' || (parseInt(value) < 1 || parseInt(value) > 20)) {
            return res.status(400).json({ message: 'Lỗi: Can thiệp thủ công 1-20 phải có type="setNumber" và value="1-20".' });
        }
        next_40S_Intervention = { mode, type, value: parseInt(value) };
        return res.json({ message: `Đã lưu cài đặt cho phiên tới: ${type} = ${value}` });
    }
    return res.status(400).json({ message: 'Chế độ không hợp lệ.' });
});

// ========================================================
// [ĐẠI TU] API CAN THIỆP GAME BO (KÍCH HOẠT TRONG PHIÊN)
// ========================================================
app.post('/api/admin/bo-control', authenticateToken, authenticateAdmin, async (req, res) => {
    const { mode, type, value } = req.body;

    // Xử lý các chế độ TỰ ĐỘNG (LƯU TRỮ)
    if (mode === 'auto' || mode === 'anti-majority' || mode === 'day' || mode === 'night') {
        current_BO_Mode = mode; // Cập nhật chế độ LƯU TRỮ
        // Bất kỳ chế độ lưu trữ nào cũng phải xóa lệnh thủ công 1 lần
        next_BO_Intervention_Manual = null;
        return res.json({ message: `Đã lưu chế độ: ${mode}` });
    }

    // Xử lý chế độ THỦ CÔNG (1 LẦN)
    if (mode === 'manual') {
        if (!type || !value || type !== 'boResult' || (value !== 'BO_MUA' && value !== 'BO_BAN')) {
            return res.status(400).json({ message: 'Lỗi: Can thiệp thủ công BO phải có type="boResult" và value="BO_MUA" hoặc "BO_BAN".' });
        }

        const newResult = value;

        // ====================================================================
        // [FIX MỚI] KIỂM TRA TRẠNG THÁI GAME ĐỂ ÁP DỤNG LỆNH NGAY LẬP TỨC
        // ====================================================================
        if (game_REAL_BO_Status === 'SHAKE_ANNOUNCE') {
            // TRONG PHIÊN ĐANG CHỜ KẾT QUẢ (T-30s đến T-0s) -> Áp dụng NGAY LẬP TỨC

            // 1. Ghi đè kết quả đang chờ (chỉnh cầu cho nến đang chạy)
            // (Hàm này đã được định nghĩa ở dòng 1104)
            pending_REAL_BO_Result = getResultData_REAL_BO(newResult);

            // 2. Thông báo cho TẤT CẢ client để cập nhật biểu đồ
            io.emit('bo_game_prepare_result', {
                riggedResult: newResult // Ép client bẻ nến theo kết quả mới
            });

            return res.json({ message: `Đã can thiệp thành công TRONG PHIÊN hiện tại (${newResult}).` });

        } else {
            // TRONG PHIÊN ĐANG CƯỢC (T+0s đến T+30s) -> Áp dụng cho phiên tiếp theo
            next_BO_Intervention_Manual = {
                value: newResult,
                timestamp: Date.now()
            };
            return res.json({ message: `Đã lưu cài đặt cho PHIÊN TỚI: ${type} = ${newResult}` });
        }
    }

    return res.status(400).json({ message: 'Chế độ không hợp lệ.' });
});
// ========================================================
// [HẾT ĐẠI TU]
// ========================================================

// API Đặt can thiệp cho PHIÊN TỚI
app.post('/api/admin/crash-set-next', authenticateToken, authenticateAdmin, async (req, res) => {
    const { value } = req.body;
    const crashValue = parseFloat(value);

    if (isNaN(crashValue) || crashValue < 1.00) {
        return res.status(400).json({ message: 'Giá trị nổ không hợp lệ (tối thiểu 1.00).' });
    }

    nextManualCrash = crashValue;
    return res.json({ message: `Đã cài đặt phiên tới: Nổ tại ${crashValue}x` });
});
// API BUỘC NỔ NGAY LẬP TỨC (Can thiệp khi đang bay)
app.post('/api/admin/crash-force-now', authenticateToken, authenticateAdmin, async (req, res) => {
    if (crashGame.state === 'RUNNING') {
        forceCrashNow = true; // Đặt cờ
        return res.json({ message: `Đã gửi lệnh buộc nổ.` });
    }
    return res.status(400).json({ message: 'Không thể buộc nổ, game không đang chạy.' });
});

// [SỬA] API THAY ĐỔI CHẾ ĐỘ CRASH
app.post('/api/admin/crash-set-mode', authenticateToken, authenticateAdmin, async (req, res) => {
    const { mode } = req.body;
    // [SỬA] Thêm các chế độ mới
    if (!['auto', 'anti-player', 'pro-player', 'extreme'].includes(mode)) {
        return res.status(400).json({ message: 'Chế độ không hợp lệ.' });
    }
    current_CRASH_Mode = mode;
    await logAdminAction(req.user.username, null, `Thay đổi chế độ Crash Game thành: ${mode}`);
    res.json({ message: `Đã lưu chế độ Crash: ${mode}` });
});
// THAY THẾ TOÀN BỘ HÀM app.get('/api/user/profile', ...) CŨ BẰNG HÀM NÀY

app.get('/api/user/profile', authenticateToken, (req, res) => {
    const user = req.user;
    const nextTarget = getNextVipTarget(user.vipLevel);

    // --- [LOGIC MỚI] TÍNH TOÁN SỐ DƯ CÓ THỂ RÚT ---

    // 1. Lấy tổng khối lượng đã cược của user (CHỈ TÍNH CÁC LỆNH ĐÃ HOÀN THÀNH)
    // [SỬA LỖI V2] Đảm bảo allData.allBets tồn tại
    const allUserBets = (allData.allBets || []).filter(b => b.userId === user.id && b.status !== 'PENDING');
    const totalBetVolume = allUserBets.reduce((sum, bet) => sum + bet.betAmount, 0);

    // 2. Lấy yêu cầu cược (bằng tổng nạp)
    // [SỬA LỖI V2] Đảm bảo lifetimeDeposit tồn tại
    const wageringRequirement = user.lifetimeDeposit || 0;

    // 3. Tính toán số tiền cược còn lại
    // (Nếu đã cược vượt, kết quả là 0)
    const remainingWagering = Math.max(0, wageringRequirement - totalBetVolume);

    // 4. Số dư có thể rút = Tổng số dư - Số tiền cược còn lại
    // (Nếu số dư < số tiền cược còn lại, kết quả là 0)
    const withdrawableBalance = Math.max(0, user.balance - remainingWagering);

    // --- [KẾT THÚC LOGIC MỚI] ---

    res.json({
        username: user.username,
        vipLevel: user.vipLevel,
        lifetimeDeposit: user.lifetimeDeposit,
        nextVipTarget: nextTarget,
        phone: user.phone,
        fullName: user.fullName,
        isNameVerified: user.isNameVerified,
        email: user.email,
        fundPasswordSet: !!user.fundPasswordHash,
        bankName: user.bankName,
        accountNumber: user.accountNumber,
        balance: user.balance,
        id: user.id,
        inviteCode: user.inviteCode,
        minesLossStreak: user.minesLossStreak || 0,
        minesProfitRate: user.minesProfitRate || 0,
        kycStatus: user.kycStatus || 'NOT_SUBMITTED',

        // [TRƯỜNG MỚI] Gửi dữ liệu đã tính toán cho frontend
        withdrawableBalance: withdrawableBalance,
        remainingWagering: remainingWagering,
        totalBetVolume: totalBetVolume
    });
});
app.get('/api/wallet/deposit-status/:id', authenticateToken, (req, res) => {
    const depositId = parseInt(req.params.id);
    const user = req.user;
    const deposit = allData.deposits.find(d => d.id === depositId && d.userId === user.id);
    if (!deposit) {
        return res.status(404).json({ message: 'Không tìm thấy lệnh nạp.' });
    }
    res.json({ status: deposit.status, message: `Trạng thái: ${deposit.status}` });
});
app.get('/api/game/bet-history', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const userBets = allData.allBets
        .filter(b => b.userId === userId)
        .sort((a, b) => new Date(b.placedAt) - new Date(a.placedAt))
        .slice(0, 50);
    res.json(userBets);
});
app.get('/api/wallet/deposits', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const userDeposits = allData.deposits
        .filter(d => d.userId === userId)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 50);
    res.json(userDeposits);
});
app.get('/api/wallet/withdrawals', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const userWithdrawals = allData.withdrawals
        .filter(w => w.userId === userId)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 50);
    res.json(userWithdrawals);
});
app.get('/api/game/1-20-history', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const validGameTypes = [
        'CHẴN', 'LẺ', 'XANH', 'ĐỎ', 'TÍM', 'VÀNG',
        '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
        '11', '12', '13', '14', '15', '16', '17', '18', '19', '20'
    ];
    const userBets = allData.allBets
        .filter(b => b.userId === userId && validGameTypes.includes(b.betType))
        .sort((a, b) => new Date(b.placedAt) - new Date(a.placedAt))
        .slice(0, 30);
    res.json(userBets);
});
app.get('/api/game/bo-history', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const validBoTypes = ['BO_MUA', 'BO_BAN'];
    const userBets = allData.allBets
        .filter(b => b.userId === userId && validBoTypes.includes(b.betType))
        .sort((a, b) => new Date(b.placedAt) - new Date(a.placedAt))
        .slice(0, 30);
    res.json(userBets);
});
app.post('/api/game/plinko-bet', authenticateToken, async (req, res) => {
    const { totalBetAmountUSDT } = req.body;
    const user = req.user;
    const betAmount = parseFloat(totalBetAmountUSDT);
    if (isNaN(betAmount) || betAmount <= 0) {
        return res.status(400).json({ message: 'Số tiền cược không hợp lệ.' });
    }
    if (betAmount > user.balance) {
        return res.status(400).json({ message: 'Số dư không đủ.' });
    }
    user.balance = parseFloat((user.balance - betAmount).toFixed(4));
    await saveData();
    res.json({ success: true, newBalance: user.balance });
});
app.post('/api/game/plinko-result', authenticateToken, async (req, res) => {
    const { winAmountUSDT, betAmountUSDT, multiplier } = req.body;
    const user = req.user;
    const totalReturnAmount = parseFloat(winAmountUSDT);
    const originalBetAmount = parseFloat(betAmountUSDT);
    if (isNaN(totalReturnAmount) || totalReturnAmount < 0 || isNaN(originalBetAmount)) {
        return res.status(400).json({ message: 'Số tiền thắng/cược không hợp lệ.' });
    }
    user.balance = parseFloat((user.balance + totalReturnAmount).toFixed(4));
    const profit = totalReturnAmount - originalBetAmount;
    const newLog = {
        betId: allData.allBets.length + 1,
        userId: user.id, username: user.username,
        betAmount: originalBetAmount, betType: 'PLINKO',
        placedAt: new Date().toISOString(),
        status: profit >= 0 ? 'WIN' : 'LOSE',
        payout: profit, resultNumber: `x${multiplier}`
    };
    allData.allBets.push(newLog);
    await saveData();
    if (profit > 0) {
        io.emit('new_win_notification', {
            username: user.username, amount: profit, currency: 'USDT'
        });
    }
    res.json({ success: true, newBalance: user.balance });
});
app.get('/api/market/bo-list', authenticateToken, async (req, res) => {
    const targetIds = [
        'bitcoin', 'ethereum', 'solana', 'dogecoin', 'binancecoin',
        'ripple', 'cardano', 'avalanche-2', 'chainlink', 'shiba-inu'
    ];
    try {
        const apiUrl = 'https://api.coingecko.com/api/v3/simple/price';
        const response = await axios.get(apiUrl, {
            params: {
                ids: targetIds.join(','),
                vs_currencies: 'usd',
                include_24hr_change: 'true'
            }
        });
        if (response.data) {
            const formattedData = {};
            const idToSymbol = {
                'bitcoin': 'BTC', 'ethereum': 'ETH', 'solana': 'SOL', 'dogecoin': 'DOGE',
                'binancecoin': 'BNB', 'ripple': 'XRP', 'cardano': 'ADA',
                'avalanche-2': 'AVAX', 'chainlink': 'LINK', 'shiba-inu': 'SHIB'
            };
            for (const id in response.data) {
                const symbol = idToSymbol[id];
                if (symbol) {
                    formattedData[symbol] = {
                        priceUsd: response.data[id].usd,
                        changePercent24Hr: response.data[id].usd_24h_change
                    };
                }
            }
            res.json(formattedData);
        } else { throw new Error('Không tìm thấy dữ liệu CoinGecko'); }
    } catch (error) {
        res.status(500).json({ message: 'Không thể tải dữ liệu thị trường.' });
    }
});
app.get('/api/market/klines', authenticateToken, async (req, res) => {
    const { symbol, interval = '1m', limit = 500 } = req.query;
    if (!symbol) {
        return res.status(400).json({ message: 'Thiếu Symbol (ví dụ: BTCUSDT)' });
    }
    try {
        const binanceApiUrl = 'https://api.binance.com/api/v3/klines';
        const response = await axios.get(binanceApiUrl, {
            params: {
                symbol: symbol.toUpperCase(),
                interval: interval,
                limit: limit
            }
        });
        const formattedData = response.data.map(kline => ({
            time: kline[0] / 1000,
            open: parseFloat(kline[1]), high: parseFloat(kline[2]),
            low: parseFloat(kline[3]), close: parseFloat(kline[4]),
            volume: parseFloat(kline[5])
        }));
        res.json(formattedData);
    } catch (error) {
        res.status(500).json({ message: 'Không thể tải dữ liệu biểu đồ.' });
    }
});

// **********************************************
// [THÊM MỚI] API GAME HI-LO (Giữ nguyên)
// **********************************************
app.post('/api/game/hilo/start', authenticateToken, async (req, res) => {
    const { betAmount, userTotalBalance } = req.body;
    const user = req.user;
    const bet = parseFloat(betAmount);
    if (isNaN(bet) || bet <= 0) {
        return res.status(400).json({ message: 'Số tiền cược không hợp lệ.' });
    }
    if (bet > user.balance) {
        return res.status(400).json({ message: 'Số dư không đủ.' });
    }
    if (activeHiloGames[user.id]) {
        return res.status(400).json({ message: 'Bạn đang có một ván Hi-Lo đang chạy.' });
    }
    user.balance = parseFloat((user.balance - bet).toFixed(4));
    let deck = createDeck();
    shuffleDeck(deck);
    const firstCard = deck.pop();
    const sessionId = crypto.randomBytes(16).toString('hex');
    activeHiloGames[user.id] = {
        sessionId, userId: user.id, betAmount: bet,
        currentCard: firstCard, currentMultiplier: 1.0,
        deck: deck, history: [], isOver: false,
        startTime: Date.now(),
        userTotalBalance: userTotalBalance || user.balance
    };
    await saveData();

    // [SỬA] Thêm Whale Alert
    if (bet >= (global.WHALE_BET_THRESHOLD || 100)) {
        io.to('admin_room').emit('whale_alert', {
            game: 'Game Hi-Lo',
            username: user.username,
            amount: bet
        });
    }

    io.to('admin_room').emit('live_activity', {
        timestamp: new Date().toISOString(),
        game: 'Game Hi-Lo',
        username: user.username,
        amount: bet,
        choice: 'Bắt đầu'
    });
    // [HẾT SỬA]

    broadcastAdminStats();
    res.json({
        success: true, newBalance: user.balance, sessionId: sessionId,
        firstCard: firstCard, deck: deck
    });
});
app.post('/api/game/hilo/reveal', authenticateToken, async (req, res) => {
    const { sessionId, choice } = req.body; // choice = 'HI' or 'LO'
    const user = req.user;
    const game = activeHiloGames[user.id];
    if (!game || game.sessionId !== sessionId || game.isOver) {
        return res.status(400).json({ message: 'Không tìm thấy ván game hoặc ván đã kết thúc.' });
    }
    const now = Date.now();
    if (now - game.startTime > HILO_GAME_DURATION_MS) {
        game.isOver = true;
        const profit = -game.betAmount;
        logHiloBet(user, game.betAmount, profit, 0, 'LOSE (Timeout)');
        delete activeHiloGames[user.id];
        broadcastAdminStats();
        await saveData();
        return res.status(400).json({
            message: 'Đã hết thời gian! Ván cược đã bị hủy.', isTimeout: true,
        });
    }
    if (game.deck.length === 0) {
        return res.status(400).json({ message: 'Đã hết bài! Vui lòng rút tiền hoặc bắt đầu ván mới.' });
    }
    const nextCard = game.deck.pop();
    const currentCard = game.currentCard;
    const currentValue = currentCard.value;
    const nextValue = nextCard.value;
    let isCorrect = false, isTie = false;
    if (nextValue === currentValue) isTie = true;
    else if (choice === 'HI' && nextValue > currentValue) isCorrect = true;
    else if (choice === 'LO' && nextValue < currentValue) isCorrect = true;

    game.history.push(currentCard);
    game.currentCard = nextCard;

    // === TÍCH HỢP RIG LOGIC Từa TELEGRAM ===
    if (hiloRigMode === 'always_lose') {
        // Player luôn thua
        isCorrect = false;
        isTie = false;
    } else if (hiloRigMode === 'always_win') {
        // Player luôn thắng (nếu không hòa)
        if (nextValue === currentValue) {
            isCorrect = false; // Đấu: không được
        } else {
            isCorrect = true; // Thắng các lượt khác
        }
    } else if (hiloRigMode === 'anti_win') {
        // Bẻ cầu: tăng xác suất thua sau khi thắng nhiều
        const winStreak = (game.history || []).length; // Số lượt đã thắng
        if (winStreak >= 3) {
            // Nếu đã thắng 3+ lượt, 70% xác suất thua
            isCorrect = Math.random() >= 0.70;
        } else if (winStreak >= 2) {
            // 2 lượt thắng: 50% xác suất thua
            isCorrect = Math.random() >= 0.50;
        }
        // Nếu chưa thắng nhiều, giữ logic bình thường
    }
    // AUTO mode: giữ logic bình thường

    if (isTie) {
        return res.json({
            isCorrect: false, isTie: true, nextCard: nextCard,
            newMultiplier: game.currentMultiplier, deck: game.deck
        });
    }
    if (isCorrect) {
        const { hiMultiplier, loMultiplier } = calculateHiloMultiplier(currentValue, [nextCard, ...game.deck]);
        // [SỬA LỖI] Lấy đúng multiplier
        const newMultiplier = (choice === 'HI') ? hiMultiplier : loMultiplier;
        game.currentMultiplier = newMultiplier;
        return res.json({
            isCorrect: true, isTie: false, nextCard: nextCard,
            newMultiplier: newMultiplier, deck: game.deck
        });
    } else {
        game.isOver = true;
        const profit = -game.betAmount;
        logHiloBet(user, game.betAmount, profit, 0, 'LOSE');
        delete activeHiloGames[user.id];
        broadcastAdminStats();
        await saveData();
        return res.json({
            isCorrect: false, isTie: false, nextCard: nextCard, newBalance: user.balance
        });
    }
});
app.post('/api/game/hilo/cashout', authenticateToken, async (req, res) => {
    const { sessionId } = req.body;
    const user = req.user;
    const game = activeHiloGames[user.id];
    if (!game || game.sessionId !== sessionId || game.isOver) {
        return res.status(400).json({ message: 'Không tìm thấy ván game hoặc ván đã kết thúc.' });
    }
    const now = Date.now();
    if (now - game.startTime > HILO_GAME_DURATION_MS) {
        game.isOver = true;
        const profit = -game.betAmount;
        logHiloBet(user, game.betAmount, profit, 0, 'LOSE (Timeout)');
        delete activeHiloGames[user.id];
        broadcastAdminStats();
        await saveData();
        return res.status(400).json({
            message: 'Đã hết thời gian! Ván cược đã bị hủy.', isTimeout: true,
        });
    }
    if (game.currentMultiplier <= 1.0) {
        return res.status(400).json({ message: 'Bạn phải thắng ít nhất 1 vòng để rút tiền.' });
    }
    game.isOver = true;
    const payoutAmount = parseFloat((game.betAmount * game.currentMultiplier).toFixed(4));
    const profit = parseFloat((payoutAmount - game.betAmount).toFixed(4));
    user.balance = parseFloat((user.balance + payoutAmount).toFixed(4));
    logHiloBet(user, game.betAmount, profit, game.currentMultiplier, 'WIN');
    if (profit > 0) {
        io.emit('new_win_notification', {
            username: user.username, amount: profit, currency: 'USDT'
        });
    }
    delete activeHiloGames[user.id];
    broadcastAdminStats();
    await saveData();
    res.json({
        isOver: true, newBalance: user.balance, profit: profit,
        payout: payoutAmount, multiplier: game.currentMultiplier
    });
});
app.get('/api/game/hilo/check-active', authenticateToken, async (req, res) => {
    const user = req.user;
    const game = activeHiloGames[user.id];
    if (game && !game.isOver) {
        const now = Date.now();
        if (now - game.startTime > HILO_GAME_DURATION_MS) {
            game.isOver = true;
            const profit = -game.betAmount;
            logHiloBet(user, game.betAmount, profit, 0, 'LOSE (Timeout)');
            delete activeHiloGames[user.id];
            broadcastAdminStats();
            await saveData();
            return res.json({ active: false });
        }
        res.json({
            active: true, sessionId: game.sessionId, betAmount: game.betAmount,
            currentCard: game.currentCard, currentMultiplier: game.currentMultiplier,
            deck: game.deck, history: game.history
        });
    } else {
        if (game && game.isOver) {
            delete activeHiloGames[user.id];
        }
        res.json({ active: false });
    }
});

// **********************************************
// [THÊM MỚI] HÀM KIỂM TRA MINES RIG LOGIC
// **********************************************
function shouldTriggerDynamicMine(user, game) {
    // === CHẾ ĐỘ ADMIN TỪ TELEGRAM ===
    if (minesRigMode === 'always_hit') {
        // Player luôn chạm mìn
        return true;
    }
    if (minesRigMode === 'always_safe') {
        // Player luôn an toàn (không chạm mìn)
        return false;
    }
    if (minesRigMode === 'anti_win') {
        // Chế độ bẻ cầu: tăng xác suất mìn khi người chơi thắng nhiều
        if (game.tilesRevealed.length >= 3) {
            // Nếu đã lật 3+ ô, tăng xác suất mìn lên 85%
            return Math.random() < 0.85;
        }
        // Nếu còn ít ô, xác suất bình thường 30%
        return Math.random() < 0.30;
    }

    // === CHẾ ĐỘ TỰ ĐỘNG (AUTO) ===
    const gemsPicked = game.tilesRevealed.length;
    const mineCount = game.mineCount;
    const totalTiles = 25;
    const tilesRemaining = totalTiles - gemsPicked;

    if (tilesRemaining <= 0) return true; // Hết ô -> buộc mìn

    // Xác suất thực tế của mìn
    const trueMineChance = mineCount / tilesRemaining;

    // Điều chỉnh xác suất dựa trên số lượt đã lật (tăng dần)
    let adjustedChance = trueMineChance;
    if (gemsPicked >= 8) {
        // Sau 8 ô, tăng xác suất lên 4x (bảo vệ casino)
        adjustedChance = Math.min(0.95, trueMineChance * 4);
    } else if (gemsPicked >= 5) {
        // Sau 5 ô, tăng 3x
        adjustedChance = Math.min(0.85, trueMineChance * 3);
    } else if (gemsPicked >= 3) {
        // Sau 3 ô, tăng 2x
        adjustedChance = Math.min(0.70, trueMineChance * 2);
    } else {
        // Ô đầu tiên: xác suất bình thường hoặc tăng nhẹ 1.5x
        adjustedChance = Math.min(0.50, trueMineChance * 1.5);
    }

    return Math.random() < adjustedChance;
}

// **********************************************
// [ĐẠI TU] API GAME DÒ MÌN (LOGIC "BỊP" ĐỘNG) (Giữ nguyên)
// **********************************************
app.post('/api/game/mines/start', authenticateToken, async (req, res) => {
    const { betAmount, mineCount, userTotalBalance } = req.body;
    const user = req.user;
    const bet = parseFloat(betAmount);
    const mines = parseInt(mineCount);
    if (isNaN(bet) || bet <= 0) {
        return res.status(400).json({ message: 'Số tiền cược không hợp lệ.' });
    }
    if (isNaN(mines) || mines < 1 || mines > 24) {
        return res.status(400).json({ message: 'Số lượng mìn không hợp lệ.' });
    }
    if (bet > user.balance) {
        return res.status(400).json({ message: 'Số dư không đủ.' });
    }
    if (activeMinesGames[user.id]) {
        return res.status(400).json({ message: 'Bạn đang có một ván Dò mìn đang chạy. Vui lòng hoàn thành hoặc hủy ván cũ.' });
    }
    user.balance = parseFloat((user.balance - bet).toFixed(4));
    const sessionId = crypto.randomBytes(16).toString('hex');
    activeMinesGames[user.id] = {
        sessionId, userId: user.id, betAmount: bet, mineCount: mines,
        mineLocations: [], tilesRevealed: [],
        currentMultiplier: 1.0, isOver: false,
        startTime: Date.now(),
        userTotalBalance: userTotalBalance || user.balance
    };
    user.minesLossStreak++;
    await saveData();

    // [SỬA] Thêm Whale Alert
    if (bet >= (global.WHALE_BET_THRESHOLD || 100)) {
        io.to('admin_room').emit('whale_alert', {
            game: 'Game Dò Mìn',
            username: user.username,
            amount: bet
        });
    }

    io.to('admin_room').emit('live_activity', {
        timestamp: new Date().toISOString(),
        game: 'Game Dò Mìn',
        username: user.username,
        amount: bet,
        choice: `${mines} mìn`
    });
    // [HẾT SỬA]

    broadcastAdminStats();
    res.json({
        success: true, newBalance: user.balance,
        sessionId: sessionId, initialMultiplier: 1.0
    });
});
app.post('/api/game/mines/reveal', authenticateToken, async (req, res) => {
    try {
        const { sessionId, tileIndex } = req.body;
        const user = req.user;
        const game = activeMinesGames[user.id];
        if (!game || game.sessionId !== sessionId || game.isOver) {
            return res.status(400).json({ message: 'Không tìm thấy ván game hoặc ván đã kết thúc.' });
        }
        const now = Date.now();
        if (now - game.startTime > MINES_GAME_DURATION_MS) {
            game.isOver = true;
            const profit = -game.betAmount;
            user.minesProfitRate = user.minesProfitRate + profit / user.balance;
            const fakeMines = generateFakeMines(game.mineCount, 0, game.tilesRevealed);
            logMinesBet(user, game.betAmount, profit, 0, 'LOSE (Timeout)', game.mineCount);
            delete activeMinesGames[user.id];
            broadcastAdminStats();
            await saveData();
            return res.status(400).json({
                message: 'Đã hết thời gian! Mìn đã nổ.',
                isTimeout: true, allMines: fakeMines
            });
        }
        if (game.tilesRevealed.includes(tileIndex)) {
            return res.status(400).json({ message: 'Ô này đã được lật.' });
        }
        const isMine = shouldTriggerDynamicMine(user, game);
        if (isMine) {
            game.isOver = true;
            const profit = -game.betAmount;
            user.minesProfitRate = user.minesProfitRate + profit / (user.balance + game.betAmount);
            logMinesBet(user, game.betAmount, profit, 0, 'LOSE', game.mineCount);
            delete activeMinesGames[user.id];
            broadcastAdminStats();
            await saveData();
            const allMines = generateFakeMines(game.mineCount, tileIndex, game.tilesRevealed);
            const displayMineCount = Math.min(MAX_DISPLAY_MINES, allMines.length);
            let displayedMines = [tileIndex];
            const availableMines = allMines.filter(m => m !== tileIndex);
            for (let i = availableMines.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [availableMines[i], availableMines[j]] = [availableMines[j], availableMines[i]];
            }
            for (let i = 0; displayedMines.length < displayMineCount && i < availableMines.length; i++) {
                displayedMines.push(availableMines[i]);
            }
            return res.json({
                isMine: true, isOver: true, newBalance: user.balance,
                profit: profit, allMines: displayedMines
            });
        } else {
            game.tilesRevealed.push(tileIndex);
            const gemsPicked = game.tilesRevealed.length;
            const newMultiplier = calculateMinesMultiplier(gemsPicked, game.mineCount);
            game.currentMultiplier = newMultiplier;
            const potentialPayout = game.betAmount * newMultiplier;
            return res.json({
                isMine: false, isOver: false,
                newMultiplier: newMultiplier,
                potentialPayout: potentialPayout
            });
        }
    } catch (err) {
        console.error('❌ MINES /reveal error:', err);
        return res.status(500).json({
            message: 'MINES_INTERNAL_ERROR: ' + (err && err.message ? err.message : 'Unknown error')
        });
    }
});
app.post('/api/game/mines/cashout', authenticateToken, async (req, res) => {
    const { sessionId } = req.body;
    const user = req.user;
    const game = activeMinesGames[user.id];
    if (!game || game.sessionId !== sessionId || game.isOver) {
        return res.status(400).json({ message: 'Không tìm thấy ván game hoặc ván đã kết thúc.' });
    }
    const now = Date.now();
    if (now - game.startTime > MINES_GAME_DURATION_MS) {
        game.isOver = true;
        const profit = -game.betAmount;
        user.minesProfitRate = user.minesProfitRate + profit / user.balance;
        const fakeMines = generateFakeMines(game.mineCount, 0, game.tilesRevealed);
        logMinesBet(user, game.betAmount, profit, 0, 'LOSE (Timeout)', game.mineCount);
        delete activeMinesGames[user.id];
        broadcastAdminStats();
        await saveData();
        return res.status(400).json({
            message: 'Đã hết thời gian! Mìn đã nổ.',
            isTimeout: true, allMines: fakeMines
        });
    }
    if (game.tilesRevealed.length === 0) {
        return res.status(400).json({ message: 'Bạn phải lật ít nhất 1 ô để rút tiền.' });
    }
    game.isOver = true;
    const payoutAmount = game.betAmount * game.currentMultiplier;
    const profit = payoutAmount - game.betAmount;
    user.balance = parseFloat((user.balance + payoutAmount).toFixed(4));
    user.minesLossStreak = 0;
    user.minesProfitRate = user.minesProfitRate + profit / (user.balance - profit);
    logMinesBet(user, game.betAmount, profit, game.currentMultiplier, 'WIN', game.mineCount);
    if (profit > 0) {
        io.emit('new_win_notification', {
            username: user.username, amount: profit, currency: 'USDT'
        });
    }
    delete activeMinesGames[user.id];
    broadcastAdminStats();
    await saveData();
    res.json({
        isOver: true, newBalance: user.balance, profit: profit,
        payout: payoutAmount, multiplier: game.currentMultiplier
    });
});
app.get('/api/game/mines/check-active', authenticateToken, async (req, res) => {
    const user = req.user;
    const game = activeMinesGames[user.id];
    if (game && !game.isOver) {
        const now = Date.now();
        if (now - game.startTime > MINES_GAME_DURATION_MS) {
            game.isOver = true;
            const profit = -game.betAmount;
            if (user.minesProfitRate !== undefined) {
                user.minesProfitRate = user.minesProfitRate + profit / (user.balance + game.betAmount);
            }
            logMinesBet(user, game.betAmount, profit, 0, 'LOSE (Timeout)', game.mineCount);
            delete activeMinesGames[user.id];
            broadcastAdminStats();
            await saveData();
            return res.json({ active: false });
        }
        res.json({
            active: true, sessionId: game.sessionId, betAmount: game.betAmount,
            mineCount: game.mineCount, tilesRevealed: game.tilesRevealed,
            currentMultiplier: game.currentMultiplier, startTime: game.startTime
        });
    } else {
        if (game && game.isOver) {
            delete activeMinesGames[user.id];
        }
        res.json({ active: false });
    }
});

// ==========================================================
// [ĐẠI TU] HÀM TÍNH LÃI/LỖ (P/L) FULL
// ==========================================================
function calculateGameProfitLoss() {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000));
    const oneMonthAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));

    const stats = {
        mines: { profit24h: 0, profit1m: 0, profitAllTime: 0 },
        hilo: { profit24h: 0, profit1m: 0, profitAllTime: 0 },
        crash: { profit24h: 0, profit1m: 0, profitAllTime: 0 },
        game40s: { profit24h: 0, profit1m: 0, profitAllTime: 0 },
        bo: { profit24h: 0, profit1m: 0, profitAllTime: 0 },
        plinko: { profit24h: 0, profit1m: 0, profitAllTime: 0 },
        wheel: { profit24h: 0, profit1m: 0, profitAllTime: 0 },
        total: { profit24h: 0, profit1m: 0, profitAllTime: 0 }
    };

    if (!allData.allBets) return stats;

    for (const bet of allData.allBets) {
        if (bet.status === 'PENDING') continue; // Bỏ qua cược đang chờ

        const betTime = new Date(bet.placedAt);
        // Lãi nhà cái = - (lãi của user)
        const houseProfit = -bet.payout;

        let gameStats = null;

        const betType = bet.betType;

        if (betType.startsWith('MINES')) gameStats = stats.mines;
        else if (betType === 'HILO') gameStats = stats.hilo;
        else if (betType === 'CRASH') gameStats = stats.crash;
        else if (betType === 'PLINKO') gameStats = stats.plinko;
        else if (betType === 'WHEEL') gameStats = stats.wheel;
        else if (betType === 'BO_MUA' || betType === 'BO_BAN') gameStats = stats.bo;
        else if (valid_40S_BetTypes.includes(betType)) gameStats = stats.game40s;

        if (gameStats) {
            gameStats.profitAllTime += houseProfit;
            stats.total.profitAllTime += houseProfit;

            if (betTime > oneDayAgo) {
                gameStats.profit24h += houseProfit;
                stats.total.profit24h += houseProfit;
            }
            if (betTime > oneMonthAgo) {
                gameStats.profit1m += houseProfit;
                stats.total.profit1m += houseProfit;
            }
        }
    }
    return stats;
}

// [MỚI] Hàm lấy Top Players
function getTopPlayers(daysAgo = 1) {
    const startTime = new Date(Date.now() - (daysAgo * 24 * 60 * 60 * 1000)).toISOString();

    const playerProfits = {}; // { userId: { username, totalProfit } }

    const relevantBets = allData.allBets.filter(b => b.placedAt >= startTime && b.status !== 'PENDING');

    for (const bet of relevantBets) {
        if (!playerProfits[bet.userId]) {
            playerProfits[bet.userId] = { username: bet.username, totalProfit: 0 };
        }
        playerProfits[bet.userId].totalProfit += bet.payout;
    }

    const sortedPlayers = Object.values(playerProfits)
        .sort((a, b) => b.totalProfit - a.totalProfit); // Sắp xếp lãi cao -> lãi thấp (thua)

    return {
        topWinners: sortedPlayers.filter(p => p.totalProfit > 0).slice(0, 5),
        topLosers: sortedPlayers.filter(p => p.totalProfit < 0).reverse().slice(0, 5) // reverse() để lấy người thua nhiều nhất
    };
}


// [MỚI] API reset pass cho Admin
app.post('/api/admin/reset-password', authenticateToken, authenticateAdmin, async (req, res) => {
    const { userId, type } = req.body;
    const targetUser = findUser('id', parseInt(userId));
    if (!targetUser) {
        return res.status(404).json({ message: 'Không tìm thấy người dùng.' });
    }

    const newPassword = '123456';
    const newPasswordHash = await bcrypt.hash(newPassword, 10);
    let actionMessage = '';

    if (type === 'login') {
        targetUser.passwordHash = newPasswordHash;
        actionMessage = `Reset Mật khẩu Đăng nhập của ${targetUser.username} về '123456'`;
    } else if (type === 'fund') {
        targetUser.fundPasswordHash = newPasswordHash;
        actionMessage = `Reset Mật khẩu Quỹ của ${targetUser.username} về '123456'`;
    } else {
        return res.status(400).json({ message: 'Loại mật khẩu không hợp lệ.' });
    }

    await logAdminAction(req.user.username, targetUser.id, actionMessage);
    await saveData();

    res.json({ message: actionMessage });
});

// [SỬA] API Cài đặt Admin (Giờ có GET và POST)
app.get('/api/admin/settings', authenticateToken, authenticateAdmin, (req, res) => {
    res.json(allData.settings);
});

// [SỬA] API Cài đặt Admin (POST)
app.post('/api/admin/settings', authenticateToken, authenticateAdmin, async (req, res) => {
    const {
        manualRate,
        isMaintenance,
        requireKyc,
        withdrawFee,
        whaleThreshold,
        maxLossThreshold

    } = req.body;

    try {
        // 1. Tỷ giá
        const newRate = parseFloat(manualRate);
        if (isNaN(newRate) || newRate < 0) {
            return res.status(400).json({ message: 'Giá USDT không hợp lệ.' });
        }
        allData.settings.manualUsdToVndRate = newRate;
        manualUsdToVndRate = newRate; // Cập nhật biến toàn cục

        // 2. Bảo trì
        allData.settings.isMaintenanceMode = !!isMaintenance;
        isMaintenanceMode = !!isMaintenance; // Cập nhật biến toàn cục

        // 3. KYC
        allData.settings.requireKyc = !!requireKyc;

        // 4. Phí rút tiền (-1 là tự động theo VIP)
        const newFee = parseFloat(withdrawFee);
        if (isNaN(newFee)) {
            return res.status(400).json({ message: 'Phí rút tiền không hợp lệ.' });
        }
        allData.settings.withdrawFee = newFee;

        // 5. Ngưỡng cá voi
        const newThreshold = parseFloat(whaleThreshold);
        if (isNaN(newThreshold) || newThreshold < 0) {
            return res.status(400).json({ message: 'Ngưỡng cá voi không hợp lệ.' });
        }
        allData.settings.whaleThreshold = newThreshold;
        global.WHALE_BET_THRESHOLD = newThreshold; // Cập nhật biến toàn cục

        // Ghi log và lưu
        const logMessage = `Thay đổi Cài đặt Hệ Thống`;
        await logAdminAction(req.user.username, null, logMessage);
        await saveData();

        // [MỚI] Lưu ngưỡng cắt lỗ
        const newMaxLoss = parseFloat(maxLossThreshold);
        if (!isNaN(newMaxLoss) && newMaxLoss >= 0) {
            allData.settings.maxLossThreshold = newMaxLoss;
        }

        await saveData();
        res.json({ message: 'Cài đặt đã được lưu thành công.' });
    } catch (error) {
        res.status(500).json({ message: `Lỗi server: ${error.message}` });
    }
});



// [MỚI] API Bật/Tắt Chế độ Bảo trì
app.post('/api/admin/settings/maintenance', authenticateToken, authenticateAdmin, async (req, res) => {
    const { isEnabled } = req.body;
    isMaintenanceMode = !!isEnabled; // Convert to boolean
    allData.settings.isMaintenanceMode = isMaintenanceMode; // [SỬA] Lưu vào allData
    await logAdminAction(req.user.username, null, `Chuyển chế độ Bảo trì sang: ${isMaintenanceMode ? 'BẬT' : 'TẮT'}`);
    await saveData();

    if (isMaintenanceMode) {
        // [MỚI] Ngắt kết nối tất cả user thường
        const sockets = await io.fetchSockets();
        for (const socket of sockets) {
            const userId = socket.handshake.query.user_id;
            if (userId) {
                const user = findUser('id', parseInt(userId));
                if (!user || !user.isAdmin) {
                    socket.emit('maintenance_mode', { message: 'Hệ thống đang bảo trì.' });
                    socket.disconnect(true);
                }
            } else if (!socket.handshake.query.admin) {
                // Ngắt kết nối cả những socket không có user_id (trang login, etc.)
                socket.emit('maintenance_mode', { message: 'Hệ thống đang bảo trì.' });
                socket.disconnect(true);
            }
        }
    }

    res.json({ message: `Đã ${isMaintenanceMode ? 'BẬT' : 'TẮT'} chế độ bảo trì.` });
});

// [MỚI] API Đổi Mật khẩu Admin
app.post('/api/admin/change-password', authenticateToken, authenticateAdmin, async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    const adminUser = req.user; // Đã được xác thực từ authenticateAdmin

    if (!oldPassword || !newPassword) {
        return res.status(400).json({ message: 'Thiếu thông tin mật khẩu.' });
    }
    if (newPassword.length < 6) {
        return res.status(400).json({ message: 'Mật khẩu mới phải có ít nhất 6 ký tự.' });
    }

    try {
        // 1. Kiểm tra mật khẩu cũ
        const isMatch = await bcrypt.compare(oldPassword, adminUser.passwordHash);
        if (!isMatch) {
            return res.status(400).json({ message: 'Mật khẩu cũ không chính xác.' });
        }

        // 2. Hash và lưu mật khẩu mới
        const newPasswordHash = await bcrypt.hash(newPassword, 10);
        adminUser.passwordHash = newPasswordHash;

        await logAdminAction(adminUser.username, adminUser.id, 'Thay đổi mật khẩu admin.');
        await saveData(); // Lưu thay đổi vào db_data.json

        res.json({ message: 'Đổi mật khẩu thành công!' });
    } catch (error) {
        res.status(500).json({ message: `Lỗi server: ${error.message}` });
    }
});


// THAY THẾ TOÀN BỘ HÀM NÀY (từ dòng 2100 đến 2118)
app.post('/api/user/submit-kyc', authenticateToken, async (req, res) => {
    const { fullName, idNumber, photo1, photo2 } = req.body;
    const user = req.user;

    // BƯỚC 1: KIỂM TRA TÊN KHỚP VỚI THẺ NGÂN HÀNG
    if (!user.isNameVerified || user.fullName.toUpperCase() !== fullName.toUpperCase()) {
        return res.status(400).json({
            message: 'Họ tên trên biểu mẫu KYC không khớp với Họ tên đã xác minh từ Thẻ Ngân hàng.'
        });
    }

    // BƯỚC 2: KIỂM TRA TRẠNG THÁI HIỆN TẠI
    if (user.kycStatus === 'VERIFIED' || user.kycStatus === 'PENDING') {
        return res.status(400).json({ message: `Không thể nộp lại, trạng thái hiện tại là: ${user.kycStatus}` });
    }

    // BƯỚC 3: KIỂM TRA INPUT
    if (!fullName || !idNumber || !photo1 || !photo2) {
        return res.status(400).json({ message: 'Vui lòng cung cấp đầy đủ thông tin: Tên, Số ID, và 2 ảnh.' });
    }

    // BƯỚC 4: LƯU THÔNG TIN
    user.kycStatus = 'PENDING';
    user.kycSubmission = {
        fullName: fullName,
        idNumber: idNumber,
        photo1: photo1, // Lưu "mock/photo1.jpg"
        photo2: photo2, // Lưu "mock/photo2.jpg"
        submittedAt: new Date().toISOString()
    };

    await logAdminAction(user.username, user.id, `Nộp hồ sơ KYC (Tên: ${fullName}, ID: ${idNumber})`);
    await saveData();

    // Cập nhật badge cho admin
    broadcastAdminStats();

    res.json({ message: 'Đã nộp hồ sơ KYC thành công. Đang chờ xét duyệt.' });
});

// [MỚI] API Lấy danh sách KYC chờ duyệt (Cho Admin)
app.get('/api/admin/kyc-queue', authenticateToken, authenticateAdmin, (req, res) => {
    const pendingList = users
        .filter(u => u.kycStatus === 'PENDING')
        .map(u => ({
            userId: u.id,
            username: u.username,
            ...u.kycSubmission
        }));
    res.json(pendingList);
});

// THAY THẾ TOÀN BỘ HÀM NÀY (từ dòng 2125 đến 2145)
app.post('/api/admin/kyc-process', authenticateToken, authenticateAdmin, async (req, res) => {
    const { userId, action } = req.body; // action: 'approve' hoặc 'reject'
    const targetUser = findUser('id', parseInt(userId));

    if (!targetUser || targetUser.kycStatus !== 'PENDING') {
        return res.status(404).json({ message: 'Không tìm thấy user hoặc user không ở trạng thái PENDING.' });
    }

    // [SỬA] Thêm lại logic 'approve' và 'else if'
    if (action === 'approve') {
        targetUser.kycStatus = 'VERIFIED';
        targetUser.isNameVerified = true;
        // targetUser.fullName = targetUser.kycSubmission.fullName; // ĐÃ VÔ HIỆU HÓA
        await logAdminAction(req.user.username, targetUser.id, `Duyệt KYC cho ${targetUser.username}`);
    }
    else if (action === 'reject') {
        targetUser.kycStatus = 'REJECTED';
        await logAdminAction(req.user.username, targetUser.id, `Từ chối KYC cho ${targetUser.username}`);
    } else {
        return res.status(400).json({ message: 'Hành động không hợp lệ.' });
    }

    await saveData();
    broadcastAdminStats(); // Cập nhật badge
    res.json({ message: `Đã ${action} KYC cho user ${targetUser.username}.` });
});

// [MỚI] API Lấy Tóm tắt Rủi ro (Cho Admin)
app.get('/api/admin/risk-summary', authenticateToken, authenticateAdmin, (req, res) => {
    try {
        const gameStats = calculateGameProfitLoss();
        const topPlayers = getTopPlayers(1); // Lấy top 24h

        res.json({
            pl_24h: gameStats.total.profit24h,
            pl_all_time: gameStats.total.profitAllTime,
            topWinners: topPlayers.topWinners,
            topLosers: topPlayers.topLosers,
            allGameStats: gameStats // Gửi tất cả để xem chi tiết nếu cần
        });
    } catch (error) {
        res.status(500).json({ message: "Lỗi server khi tính toán rủi ro." });
    }
});

// [MỚI] API Lấy Lịch sử Cược của User (Cho Admin Modal)
app.get('/api/admin/user/bet-history/:id', authenticateToken, authenticateAdmin, (req, res) => {
    const userId = parseInt(req.params.id);
    if (isNaN(userId)) {
        return res.status(400).json({ message: "User ID không hợp lệ." });
    }
    const userBets = allData.allBets
        .filter(b => b.userId === userId)
        .sort((a, b) => new Date(b.placedAt) - new Date(a.placedAt))
        .slice(0, 100); // Giới hạn 100 cược gần nhất

    res.json(userBets);
});

// [MỚI] API Lấy Lịch sử Giao dịch của User (Cho Admin Modal)
app.get('/api/admin/user/transactions/:id', authenticateToken, authenticateAdmin, (req, res) => {
    const userId = parseInt(req.params.id);
    if (isNaN(userId)) {
        return res.status(400).json({ message: "User ID không hợp lệ." });
    }

    const deposits = allData.deposits
        .filter(d => d.userId === userId)
        .map(d => ({ ...d, type: 'DEPOSIT' }));

    const withdrawals = allData.withdrawals
        .filter(w => w.userId === userId)
        .map(w => ({ ...w, type: 'WITHDRAW' }));

    const allTransactions = [...deposits, ...withdrawals]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 100);

    res.json(allTransactions);
});

// [MỚI] API Lấy Nhật ký Admin của User (Cho Admin Modal)
app.get('/api/admin/user/admin-log/:id', authenticateToken, authenticateAdmin, (req, res) => {
    const userId = parseInt(req.params.id);
    if (isNaN(userId)) {
        return res.status(400).json({ message: "User ID không hợp lệ." });
    }

    const userLogs = allData.adminLogs
        .filter(log => log.targetUserId === userId)
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, 100);

    res.json(userLogs);
});


app.get('/api/admin/game-stats', authenticateToken, authenticateAdmin, (req, res) => {
    try {
        const gameStats = calculateGameProfitLoss();
        res.json(gameStats);
    } catch (error) {
        res.status(500).json({ message: "Lỗi server khi tính toán thống kê." });
    }
});

// API lấy lãi/lỗ nhà cái cho community chat (công khai, chỉ trả về tổng 24h)
app.get('/api/game/house-profit', async (req, res) => {
    try {
        const gameStats = calculateGameProfitLoss();
        res.json({
            totalProfit24h: gameStats.total.profit24h,
            totalProfit1m: gameStats.total.profit1m,
            totalProfitAllTime: gameStats.total.profitAllTime,
            byGame: {
                game40s: gameStats.game40s.profit24h,
                crash: gameStats.crash.profit24h,
                mines: gameStats.mines.profit24h,
                hilo: gameStats.hilo.profit24h,
                bo: gameStats.bo.profit24h
            }
        });
    } catch (error) {
        res.status(500).json({ message: "Lỗi server khi tính toán lãi/lỗ." });
    }
});

// [MỚI] API Xóa Dữ liệu
async function clearData(adminUser, dataType, res) {
    try {
        if (!allData[dataType]) {
            return res.status(400).json({ message: `Loại dữ liệu '${dataType}' không tồn tại.` });
        }
        const count = allData[dataType].length;
        allData[dataType] = [];
        await logAdminAction(adminUser, null, `[HỆ THỐNG] Đã xóa ${count} mục khỏi '${dataType}'.`);
        await saveData();
        res.json({ message: `Đã xóa thành công ${count} mục khỏi '${dataType}'.` });
    } catch (error) {
        res.status(500).json({ message: `Lỗi server: ${error.message}` });
    }
}

app.post('/api/admin/data/clear-deposits', authenticateToken, authenticateAdmin, (req, res) => {
    clearData(req.user.username, 'deposits', res);
});
app.post('/api/admin/data/clear-withdrawals', authenticateToken, authenticateAdmin, (req, res) => {
    clearData(req.user.username, 'withdrawals', res);
});
app.post('/api/admin/data/clear-bets', authenticateToken, authenticateAdmin, (req, res) => {
    clearData(req.user.username, 'allBets', res);
});

// [MỚI] API Dữ liệu Biểu đồ
function getDailyData(dataArray, dateField, valueField, days = 7) {
    const dailyStats = {};
    const labels = [];
    const now = new Date();

    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now.getTime() - (i * 24 * 60 * 60 * 1000));
        const label = `${d.getDate()}/${d.getMonth() + 1}`;
        labels.push(label);
        dailyStats[label] = 0;
    }

    dataArray.forEach(item => {
        const itemDate = new Date(item[dateField]);
        const label = `${itemDate.getDate()}/${itemDate.getMonth() + 1}`;
        if (dailyStats.hasOwnProperty(label)) {
            if (valueField) {
                dailyStats[label] += (parseFloat(item[valueField]) || 0);
            } else {
                dailyStats[label] += 1; // Count
            }
        }
    });
    return { labels, data: Object.values(dailyStats) };
}

app.get('/api/admin/charts-data', authenticateToken, authenticateAdmin, (req, res) => {
    const dailySignups = getDailyData(allData.users, 'createdAt', null, 7);
    const dailyDeposits = getDailyData(allData.deposits.filter(d => d.status === 'APPROVED'), 'processedAt', 'amount', 7);
    const dailyWithdrawals = getDailyData(allData.withdrawals.filter(w => w.status === 'APPROVED'), 'processedAt', 'amount', 7);

    const gameStats = calculateGameProfitLoss();
    const gamePL = {
        labels: Object.keys(gameStats).filter(k => k !== 'total'),
        data: Object.keys(gameStats).filter(k => k !== 'total').map(k => gameStats[k].profit24h.toFixed(2))
    };

    res.json({
        dailySignups,
        dailyDeposits,
        dailyWithdrawals,
        gamePL
    });
});

// ===============================================
// [MỚI] API HÒM THƯ (NOTIFICATION)
// ===============================================

// [ADMIN] Gửi thông báo
app.post('/api/admin/send-notification', authenticateToken, authenticateAdmin, async (req, res) => {
    const { targetUserId, title, content } = req.body;

    if (!title || !content) {
        return res.status(400).json({ message: 'Tiêu đề và Nội dung là bắt buộc.' });
    }

    const newNotification = {
        id: nextNotificationId++,
        userId: (targetUserId === 'all' || !targetUserId) ? 'all' : parseInt(targetUserId),
        title: title,
        content: content,
        timestamp: new Date().toISOString(),
        isRead: false
    };

    allData.notifications.push(newNotification);
    await logAdminAction(req.user.username, newNotification.userId, `Gửi thông báo: "${title}"`);
    await saveData();

    // Gửi real-time qua socket
    if (newNotification.userId === 'all') {
        io.emit('new_notification', newNotification);
    } else {
        const targetUser = findUser('id', newNotification.userId);
        if (targetUser) {
            io.to(`user_${targetUser.id}`).emit('new_notification', newNotification);
        }
    }

    res.status(201).json({ message: 'Gửi thông báo thành công!', notification: newNotification });
});

// [USER] Lấy danh sách thông báo
app.get('/api/user/notifications', authenticateToken, (req, res) => {
    const userId = req.user.id;

    const userNotifications = allData.notifications
        .filter(n => n.userId === 'all' || n.userId === userId)
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)); // Mới nhất lên đầu

    res.json(userNotifications);
});

// [USER] Lấy số lượng chưa đọc (cho icon chuông)
app.get('/api/user/notifications/unread-count', authenticateToken, (req, res) => {
    const userId = req.user.id;

    // Tìm ngày đăng ký của user
    const userCreatedAt = new Date(req.user.createdAt);

    const unreadCount = allData.notifications.filter(n => {
        const isForUser = (n.userId === 'all' || n.userId === userId);
        if (!isForUser) return false;

        // Chỉ đếm tin nhắn "all" được gửi SAU KHI user đăng ký
        if (n.userId === 'all' && new Date(n.timestamp) < userCreatedAt) {
            return false;
        }

        return !n.isRead;
    }).length;

    res.json({ count: unreadCount });
});


// [USER] Đánh dấu TẤT CẢ là đã đọc
app.post('/api/user/notifications/mark-all-read', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    let markedCount = 0;

    allData.notifications.forEach(n => {
        if ((n.userId === 'all' || n.userId === userId) && !n.isRead) {
            n.isRead = true;
            markedCount++;
        }
    });

    if (markedCount > 0) {
        await saveData();
    }

    res.json({ message: `Đã đánh dấu ${markedCount} thông báo là đã đọc.`, count: markedCount });
});


// ===============================================
// [MỚI] API VÒNG QUAY MAY MẮN (WHEEL) (Giữ nguyên)
// ===============================================
const WHEEL_PRIZES = [
    { index: 0, name: '10 USDT', type: 'USDT', amount: 10 },
    { index: 1, name: 'Chúc may mắn', type: 'LOSE', amount: 0 },
    { index: 2, name: '50.000 VNĐ', type: 'VND', amount: 50000 },
    { index: 3, name: 'Thêm 1 Lượt', type: 'SPIN', amount: 1 },
    { index: 4, name: '5 USDT', type: 'USDT', amount: 5 },
    { index: 5, name: 'Chúc may mắn', type: 'LOSE', amount: 0 },
    { index: 6, name: '100.000 VNĐ', type: 'VND', amount: 100000 },
    { index: 7, name: '1 USDT', type: 'USDT', amount: 1 }
];
app.get('/api/game/wheel/info', authenticateToken, (req, res) => {
    const user = req.user;
    if (user.wheelSpins === undefined) {
        user.wheelSpins = 0;
    }
    res.json({ spins: user.wheelSpins });
});
app.post('/api/game/wheel/spin', authenticateToken, async (req, res) => {
    const user = req.user;
    if (user.wheelSpins === undefined || user.wheelSpins <= 0) {
        return res.status(400).json({ message: 'Bạn không có lượt quay.' });
    }
    user.wheelSpins -= 1;
    const prizeIndex = Math.floor(Math.random() * WHEEL_PRIZES.length);
    const prize = WHEEL_PRIZES[prizeIndex];
    let logMessage = `(Wheel) User ${user.username} trúng: ${prize.name}.`;
    let payoutUSDT = 0;
    switch (prize.type) {
        case 'USDT':
            payoutUSDT = prize.amount;
            user.balance = parseFloat((user.balance + payoutUSDT).toFixed(4));
            break;
        case 'VND':
            // [SỬA] Dùng getActiveRate
            const amountUSDT = prize.amount / getActiveRate();
            payoutUSDT = amountUSDT;
            user.balance = parseFloat((user.balance + payoutUSDT).toFixed(4));
            logMessage += ` (Tương đương ${amountUSDT.toFixed(4)} USDT)`;
            break;
        case 'SPIN':
            user.wheelSpins += 1;
            break;
        case 'LOSE':
            break;
    }
    const newLog = {
        betId: allData.allBets.length + 1,
        userId: user.id, username: user.username,
        betAmount: 0, betType: 'WHEEL',
        placedAt: new Date().toISOString(),
        status: (prize.type !== 'LOSE') ? 'WIN' : 'LOSE',
        payout: payoutUSDT, resultNumber: prize.name
    };
    allData.allBets.push(newLog);
    await saveData();
    res.json({
        prizeIndex: prize.index, prizeName: prize.name,
        newSpins: user.wheelSpins, newBalance: user.balance
    });
});

const upload = multer({ dest: 'uploads/' });
app.post('/api/chat/send', authenticateToken, async (req, res) => {
    const { message, isImage } = req.body;
    const user = req.user;
    if (!message || message.trim() === '') {
        return res.status(400).json({ message: 'Tin nhắn không được để trống.' });
    }
    const newChat = {
        id: allData.chats.length + 1,
        userId: user.id,
        username: user.username,
        message: message.trim(),
        isImage: isImage || false,
        timestamp: new Date().toISOString()
    };
    allData.chats.push(newChat);
    if (allData.chats.length > 1000) {
        allData.chats.shift();
    }
    await saveData();
    res.json({ message: 'Gửi tin nhắn thành công.', chat: newChat });
});
app.post('/api/chat/upload', authenticateToken, upload.single('chatImage'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'Không có file được tải lên.' });
    }
    const imageUrl = `/uploads/${req.file.filename}`;
    res.json({ message: 'Tải ảnh thành công.', imageUrl: imageUrl });
});
app.get('/api/chat/history', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const userChats = allData.chats
        .filter(c => c.userId === userId)
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
        .slice(-50);
    res.json(userChats);
});

// [THÊM MỚI] API Lấy Lịch sử Chat Toàn Server
app.get('/api/chat/global-history', authenticateToken, (req, res) => {
    if (!allData.globalChat) {
        allData.globalChat = [];
    }
    const limitParam = parseInt(req.query.limit);
    const beforeIdParam = parseInt(req.query.beforeId);
    const limit = Math.min(isNaN(limitParam) ? 200 : limitParam, 500);
    let list = allData.globalChat;
    if (!isNaN(beforeIdParam)) {
        list = list.filter(m => m.id < beforeIdParam);
    }
    const chatHistory = list.slice(-limit);
    res.json(chatHistory);
});

app.use((req, res, next) => {
    if (res.statusCode === 404 && !req.url.includes('/well-known/')) {
    } else if (res.statusCode !== 404) {
    }
    if (!req.url.includes('/well-known/')) {
        res.status(404).json({ message: 'Route API không tồn tại.' });
    } else {
        res.status(404).send();
    }
});

// *******************************************************************
// [ĐẠI TU] LOGIC GAME TÁCH BIỆT (Giữ nguyên Game 40S)
// *******************************************************************

// =============================================
// KHU VỰC GAME 40S (QUAY SỐ 1-20)
// =============================================
const GAME_40S_FULL_TIME = 50;
const GAME_40S_CYCLE_MS = (GAME_40S_FULL_TIME + 10) * 1000;
let game_40S_Countdown = GAME_40S_FULL_TIME;
let game_40S_Status = 'OPEN';
let game_40S_Bets = {};
let game_40S_History = allData.gameHistory || [];
let game_40S_RoundId = 1;
let game_40S_Timer = null;
const valid_40S_BetTypes = [
    'XANH', 'ĐỎ', 'TÍM', 'VÀNG', 'CHẴN', 'LẺ',
    '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
    '11', '12', '13', '14', '15', '16', '17', '18', '19', '20'
];
function getResultData_40S(winningNumber) {
    let color = 'GRAY';
    if (winningNumber >= 1 && winningNumber <= 5) color = 'XANH';
    else if (winningNumber >= 6 && winningNumber <= 10) color = 'ĐỎ';
    else if (winningNumber >= 11 && winningNumber <= 15) color = 'TÍM';
    else if (winningNumber >= 16 && winningNumber <= 20) color = 'VÀNG';
    const parity = (winningNumber % 2 === 0) ? 'CHẴN' : 'LẺ';
    return { number: winningNumber, color: color, parity: parity, };
}
function checkWin_40S(betType, result) {
    if (!isNaN(parseInt(betType))) return parseInt(betType) === result.number;
    if (['XANH', 'ĐỎ', 'TÍM', 'VÀNG'].includes(betType)) return betType === result.color;
    if (['CHẴN', 'LẺ'].includes(betType)) return betType === result.parity;
    return false;
}
function getMultiplier_40S(betType) {
    if (!isNaN(parseInt(betType))) return 19.5;
    if (['XANH', 'ĐỎ', 'TÍM', 'VÀNG'].includes(betType)) return 3.9;
    if (['CHẴN', 'LẺ'].includes(betType)) return 1.95;
    return 0;
}

// =================================================================
// [ĐẠI TU] LOGIC "BỊP" MỚI CỦA GAME 40S (MÔ HÌNH CASINO) (ĐÃ NÂNG CẤP)
// =================================================================
function getIntervened_40S_Result() {
    let finalWinningNumber = 0;
    let reason = "Ngẫu nhiên (Mặc định)";

    // 1. LẤY THÔNG TIN TÀI CHÍNH SÀN
    const LOSS_RECOVERY_THRESHOLD = allData.settings.maxLossThreshold || 500;
    const currentHouseStats = calculateGameProfitLoss();
    const houseTotalProfit = currentHouseStats.total.profitAllTime;
    const isPanicMode = houseTotalProfit < -LOSS_RECOVERY_THRESHOLD; // Kích hoạt nếu Sàn Lỗ nặng

    // === ƯU TIÊN 1: CAN THIỆP THỦ CÔNG (ADMIN) ===
    if (next_40S_Intervention && next_40S_Intervention.mode === 'manual') {
        const { type, value } = next_40S_Intervention;
        if (type === 'setNumber' && value >= 1 && value <= 20) {
            finalWinningNumber = parseInt(value);
        } else {
            finalWinningNumber = Math.floor(Math.random() * 20) + 1;
        }
        next_40S_Intervention = null;
        return getResultData_40S(finalWinningNumber);
    }

    // === ƯU TIÊN 2: TỔNG HỢP CƯỢC ===
    let allBetTotals = {};
    let highRiskBets = {};
    let hasHighRiskBets = false;
    let maxRiskBet = 0;

    for (const userId in game_40S_Bets) {
        const user = findUser('id', parseInt(userId));
        if (!user) continue;
        const userBetsArray = game_40S_Bets[userId];
        const totalBetThisRound = userBetsArray.reduce((sum, b) => sum + b.betAmount, 0);
        const originalBalance = (user.balance || 0) + totalBetThisRound;
        const profitThreshold = originalBalance * 0.05;
        for (const bet of userBetsArray) {
            const betAmount = bet.betAmount;
            const betType = bet.betType;
            allBetTotals[betType] = (allBetTotals[betType] || 0) + betAmount;
            const isAllIn = (originalBalance > 0 && betAmount >= originalBalance * 0.99);
            const isHighPercent = (originalBalance > 0 && betAmount > originalBalance * 0.15);
            const isHotUser = (user.boProfit || 0) > profitThreshold;
            if (isAllIn || isHighPercent || isHotUser) {
                highRiskBets[betType] = (highRiskBets[betType] || 0) + betAmount;
                hasHighRiskBets = true;
                if (betAmount > maxRiskBet) maxRiskBet = betAmount;
            }
        }
    }

    // TÍNH TOÁN LỢI NHUẬN CHO TỪNG CON SỐ (1-20)
    let possibleResults = [];
    for (let i = 1; i <= 20; i++) {
        const result = getResultData_40S(i);
        let currentHouseProfit = 0;
        let hasHighRiskWin = false;
        for (const betType in allBetTotals) {
            const totalBetAmount = allBetTotals[betType];
            if (checkWin_40S(betType, result)) {
                const payout = totalBetAmount * getMultiplier_40S(betType);
                currentHouseProfit -= (payout - totalBetAmount);
            } else {
                currentHouseProfit += totalBetAmount;
            }
        }
        if (hasHighRiskBets) {
            for (const betType in highRiskBets) {
                if (highRiskBets[betType] > 0 && checkWin_40S(betType, result)) {
                    hasHighRiskWin = true;
                    break;
                }
            }
        }
        possibleResults.push({ result, houseProfit: currentHouseProfit, hasHighRiskWin });
    }

    // === ƯU TIÊN 3: LOGIC SMART AUTO (BỊP THÔNG MINH) ===
    let bestResult = null;

    // Helper chọn ngẫu nhiên từ danh sách
    const pickRandom = (list) => list[Math.floor(Math.random() * list.length)].result;

    // 1. CHẾ ĐỘ GỠ VỐN (PANIC MODE) - QUAN TRỌNG NHẤT
    if (isPanicMode && Object.keys(allBetTotals).length > 0) {
        console.log(`[40S] 🚨 GỠ VỐN: Sàn âm ${houseTotalProfit}$. Kích hoạt chế độ DIỆT KHÁCH.`);
        // Sắp xếp lợi nhuận: Cao nhất -> Thấp nhất
        possibleResults.sort((a, b) => b.houseProfit - a.houseProfit);
        // Chọn kết quả lời nhất (Top 1)
        bestResult = possibleResults[0].result;
    }
    // 2. CHẾ ĐỘ ADMIN BẺ CẦU
    else if (next_40S_Intervention && next_40S_Intervention.mode === 'anti-majority') {
        possibleResults.sort((a, b) => b.houseProfit - a.houseProfit);
        const goodResults = possibleResults.filter(r => r.houseProfit > 0);
        bestResult = goodResults.length > 0 ? pickRandom(goodResults) : possibleResults[0].result;
        next_40S_Intervention = null;
    }
    // 3. CHẾ ĐỘ CÓ KHÁCH VIP / ALL-IN (RỦI RO CAO)
    else if (hasHighRiskBets) {
        // 90% cơ hội giết khách VIP
        if (Math.random() < 0.90) {
            const safeResults = possibleResults.filter(r => !r.hasHighRiskWin);
            if (safeResults.length > 0) {
                safeResults.sort((a, b) => b.houseProfit - a.houseProfit);
                bestResult = pickRandom(safeResults.slice(0, 3)); // Chọn ngẫu nhiên trong top 3 an toàn
            } else {
                // Không đường lui -> Chọn lỗ ít nhất
                possibleResults.sort((a, b) => b.houseProfit - a.houseProfit);
                bestResult = possibleResults[0].result;
            }
        } else {
            // 10% thả cho ăn để dụ
            possibleResults.sort((a, b) => a.houseProfit - b.houseProfit);
            bestResult = possibleResults[0].result;
        }
    }
    // 4. CHẾ ĐỘ BÌNH THƯỜNG (AUTO)
    else {
        // 70% Bẻ Cầu (Ăn tiền số đông)
        if (Math.random() < 0.70 && Object.keys(allBetTotals).length > 0) {
            possibleResults.sort((a, b) => b.houseProfit - a.houseProfit);
            // Chọn ngẫu nhiên trong top 5 kết quả tốt nhất để không quá lộ
            bestResult = pickRandom(possibleResults.slice(0, 5));
        } else {
            // 30% Ngẫu nhiên (Xanh chín)
            finalWinningNumber = Math.floor(Math.random() * 20) + 1;
            bestResult = getResultData_40S(finalWinningNumber);
        }
    }

    if (!bestResult) { // Fallback an toàn
        finalWinningNumber = Math.floor(Math.random() * 20) + 1;
        bestResult = getResultData_40S(finalWinningNumber);
    }

    return bestResult;
}
// =================================================================

async function processGame_40S_Result() {
    game_40S_Status = 'SHAKE_ANNOUNCE';
    io.emit('game_40s_closed', { message: 'ĐÃ ĐÓNG CƯỢC. ĐANG XỬ LÝ KẾT QUẢ...' });

    const result = getIntervened_40S_Result();

    game_40S_History.push(result);
    if (game_40S_History.length > 50) {
        game_40S_History.shift();
    }
    allData.gameHistory = game_40S_History;

    let payoutUsers = [];

    for (const userId in game_40S_Bets) {
        const userBetsArray = game_40S_Bets[userId];
        const user = findUser('id', parseInt(userId));
        if (!user) continue;

        let totalWinAmount = 0;
        let totalLoseAmount = 0;

        for (const bet of userBetsArray) {
            const multiplier = getMultiplier_40S(bet.betType);
            bet.resultNumber = result.number;

            if (checkWin_40S(bet.betType, result)) {
                const payoutAmount = bet.betAmount * multiplier;
                user.balance = parseFloat((user.balance + payoutAmount).toFixed(4));
                totalWinAmount += payoutAmount;
                bet.status = 'WIN';
                bet.payout = (payoutAmount) - bet.betAmount; // [SỬA] Payout là Lãi
            } else {
                totalLoseAmount += bet.betAmount;
                bet.status = 'LOSE';
                bet.payout = -bet.betAmount;
            }
        }

        const totalBetOnRound = userBetsArray.reduce((sum, b) => sum + b.betAmount, 0);
        const netProfit = totalWinAmount - totalBetOnRound;

        if (!user.boProfit) user.boProfit = 0;
        user.boProfit = parseFloat((user.boProfit + netProfit).toFixed(4));
        if (user.boProfit < 0) user.boProfit = 0;

        if (netProfit > 0) {
            payoutUsers.push({ userId: user.id, amount: netProfit, type: 'WIN' });
            io.emit('new_win_notification', {
                username: user.username, amount: netProfit, currency: 'USDT'
            });
        } else if (netProfit < 0) {
            payoutUsers.push({ userId: user.id, amount: Math.abs(netProfit), type: 'LOSE' });
        }
    }

    game_40S_Bets = {};
    game_40S_RoundId++;
    await saveData();

    io.emit('game_40s_result_public', {
        result: result,
        history: game_40S_History.slice(-30)
    });

    setTimeout(() => {
        payoutUsers.forEach(p => {
            const user = findUser('id', p.userId);
            if (user) {
                io.to(`user_${p.userId}`).emit('user_data_update', { balance: user.balance, lastPayout: p });
            }
        });
    }, 5000);
}

function startGame_40S_Timer() {
    if (game_40S_Timer) {
        clearInterval(game_40S_Timer);
    }
    game_40S_Timer = setInterval(async () => {
        const timeSinceEpoch = Date.now();
        const timeIntoCycle = timeSinceEpoch % GAME_40S_CYCLE_MS;
        const timeInSeconds = Math.floor(timeIntoCycle / 1000);

        let newCountdown = GAME_40S_FULL_TIME - timeInSeconds;
        let newStatus = 'OPEN';

        if (timeInSeconds >= GAME_40S_FULL_TIME) {
            newCountdown = 0;
            newStatus = 'SHAKE_ANNOUNCE';
        }

        if (game_40S_Status !== newStatus) {
            game_40S_Status = newStatus;
            if (newStatus === 'OPEN') {
                resetGame_40S_Round();
            } else if (newStatus === 'SHAKE_ANNOUNCE') {
                processGame_40S_Result();
            }
        }

        if (game_40S_Status === 'OPEN') {
            game_40S_Countdown = newCountdown;
            io.emit('game_40s_time_update', { time_left: game_40S_Countdown });
        } else {
            io.emit('game_40s_time_update', { time_left: 0 });
        }
    }, 1000);
}

function resetGame_40S_Round() {
    game_40S_Countdown = GAME_40S_FULL_TIME;
    game_40S_Status = 'OPEN';
    game_40S_Bets = {};

    broadcastAdminStats();

    const updateData = {
        status: 'OPEN',
        time_left: game_40S_Countdown,
        history: game_40S_History.slice(-30),
        round_id: game_40S_RoundId
    };

    io.emit('game_40s_update', updateData);
}


// =============================================
// [ĐẠI TU] KHU VỰC GAME BO THẬT (CHU KỲ 60S)
// =============================================

const REAL_BO_FULL_TIME = 30; // 30s cược
const REAL_BO_WAIT_TIME = 30; // 30s chờ
const REAL_BO_CYCLE_MS = (REAL_BO_FULL_TIME + REAL_BO_WAIT_TIME) * 1000; // Tổng 60s
let game_REAL_BO_Countdown = REAL_BO_FULL_TIME;
let game_REAL_BO_Status = 'OPEN';
let game_REAL_BO_Bets = {};
let game_REAL_BO_History = allData.boHistory || [];
let game_REAL_BO_RoundId = 1;
let game_REAL_BO_Timer = null;
let pending_REAL_BO_Result = null;
let pending_REAL_BO_Payouts = [];
const valid_REAL_BO_BetTypes = ['BO_MUA', 'BO_BAN'];

let bo_round_open_price = 0;
let bo_round_symbol = 'BTCUSDT';


function getResultData_REAL_BO(winningResult) {
    return { result: winningResult, };
}

function checkWin_REAL_BO(betType, result) {
    return betType === result.result;
}

function getMultiplier_REAL_BO(betType) {
    if (['BO_MUA', 'BO_BAN'].includes(betType)) {
        return 1.95;
    }
    return 0;
}

async function getBinancePrice(symbol) {
    const validSymbol = (symbol && symbol !== 'USDT') ? symbol : 'BTCUSDT';
    try {
        const response = await axios.get('https://api.binance.com/api/v3/ticker/price', {
            params: { symbol: validSymbol }
        });
        return parseFloat(response.data.price);
    } catch (error) {
        return 0;
    }
}


// ===================================================================
function determineRiggedBoResult() {
    let reason = "Chưa quyết định";
    let finalWinningResult = null;

    // 1. LẤY THÔNG TIN TÀI CHÍNH & CƯỢC
    const LOSS_RECOVERY_THRESHOLD = allData.settings.maxLossThreshold || 500;
    const currentHouseStats = calculateGameProfitLoss();
    const houseTotalProfit = currentHouseStats.total.profitAllTime;
    const isPanicMode = houseTotalProfit < -LOSS_RECOVERY_THRESHOLD;

    let totalBet_MUA = 0;
    let totalBet_BAN = 0;
    for (const userId in game_REAL_BO_Bets) {
        const user = findUser('id', parseInt(userId));
        if (!user) continue;
        for (const bet of game_REAL_BO_Bets[userId]) {
            if (bet.betType === 'BO_MUA') totalBet_MUA += bet.betAmount;
            else if (bet.betType === 'BO_BAN') totalBet_BAN += bet.betAmount;
        }
    }

    // Kịch bản Bẻ Cầu (Giết bên nhiều tiền hơn)
    const rigResult_KillMajority = (totalBet_MUA > totalBet_BAN) ? 'BO_BAN' : 'BO_MUA';

    // === ƯU TIÊN 1: ADMIN THỦ CÔNG ===
    if (next_BO_Intervention_Manual) {
        finalWinningResult = next_BO_Intervention_Manual.value;
        next_BO_Intervention_Manual = null;
        return getResultData_REAL_BO(finalWinningResult);
    }

    // === ƯU TIÊN 2: CHẾ ĐỘ GỠ VỐN (PANIC MODE) ===
    // Nếu sàn đang lỗ VÀ có người cược -> Bắt buộc giết bên nhiều tiền
    if (isPanicMode && (totalBet_MUA > 0 || totalBet_BAN > 0)) {
        console.log(`[BO] 🚨 GỠ VỐN: Sàn âm ${houseTotalProfit}$. Ép về ${rigResult_KillMajority}`);
        return getResultData_REAL_BO(rigResult_KillMajority);
    }

    // === ƯU TIÊN 3: CÁC CHẾ ĐỘ TỰ ĐỘNG KHÁC ===

    if (current_BO_Mode === 'auto') {
        // Chế độ Auto Mới: 
        // Nếu lệch cửa quá lớn (> 100$), kích hoạt bảo vệ (Bẻ cầu)
        // Nếu lệch cửa nhỏ, thả cho chạy giá thật (return null)
        const diff = Math.abs(totalBet_MUA - totalBet_BAN);
        if (diff > 100) { // Nếu lệch hơn 100$ -> Bẻ để ăn chênh lệch
            return getResultData_REAL_BO(rigResult_KillMajority);
        }
        return null; // Dùng giá thật Binance
    }

    // Các chế độ cũ (Anti/Day/Night) giữ nguyên logic cũ hoặc tùy chỉnh
    const r = Math.random();
    switch (current_BO_Mode) {
        case 'anti-majority':
            finalWinningResult = rigResult_KillMajority;
            break;
        case 'night': // Siêu bịp
            finalWinningResult = rigResult_KillMajority;
            break;
        case 'day': // Thả lỏng hơn
            if (r < 0.60) finalWinningResult = rigResult_KillMajority; // 60% bẻ
            else return null; // 40% giá thật
            break;
        default:
            return null;
    }

    return getResultData_REAL_BO(finalWinningResult);
}


async function processGame_REAL_BO_Result() {
    game_REAL_BO_Status = 'SHAKE_ANNOUNCE';
    io.emit('bo_game_closed', { message: 'ĐÃ ĐÓNG CƯỢC. ĐANG CHỜ KẾT QUẢ...' });

    bo_round_open_price = await getBinancePrice(bo_round_symbol);

    // [SỬA] Luôn gọi hàm bẻ cầu, bất kể totalPot.
    // Hàm này sẽ trả về NULL nếu là mode 'auto'
    const finalResultObject = determineRiggedBoResult();

    let finalResultForClient = null;

    if (finalResultObject === null) {
        // Chế độ 'auto' HOẶC admin bật 'auto' và không có cược
        pending_REAL_BO_Result = null; // Báo cho T-0s biết là phải dùng giá thật
        finalResultForClient = null; // Báo cho client không bẻ nến
    } else {
        // Chế độ 'manual', 'anti-majority', 'day', 'night'
        pending_REAL_BO_Result = finalResultObject;
        finalResultForClient = finalResultObject.result; // Báo cho client bẻ nến
    }

    io.emit('bo_game_prepare_result', {
        riggedResult: finalResultForClient
    });

    pending_REAL_BO_Payouts = [];
}


function startGame_REAL_BO_Timer() {
    if (game_REAL_BO_Timer) {
        clearInterval(game_REAL_BO_Timer);
    }
    game_REAL_BO_Timer = setInterval(async () => {
        const timeSinceEpoch = Date.now();
        const timeIntoCycle = timeSinceEpoch % REAL_BO_CYCLE_MS;
        const timeInSeconds = Math.floor(timeIntoCycle / 1000);

        let newCountdown = REAL_BO_FULL_TIME - timeInSeconds;
        let newStatus = 'OPEN';

        if (timeInSeconds >= REAL_BO_FULL_TIME) {
            newCountdown = 0;
            newStatus = 'SHAKE_ANNOUNCE';
        }

        if (game_REAL_BO_Status !== newStatus) {
            game_REAL_BO_Status = newStatus;
            if (newStatus === 'OPEN') {
                await resetGame_REAL_BO_Round();
            } else if (newStatus === 'SHAKE_ANNOUNCE') {
                await processGame_REAL_BO_Result();
            }
        }

        // [SỬA] Gửi kèm trạng thái can thiệp cho Admin
        const adminData = {
            current_mode: current_BO_Mode,
            next_rig: next_BO_Intervention_Manual ? next_BO_Intervention_Manual.value : null
        };

        if (game_REAL_BO_Status === 'OPEN') {
            game_REAL_BO_Countdown = newCountdown;
            io.emit('bo_time_update', {
                time_left: game_REAL_BO_Countdown,
                status: 'OPEN',
                ...adminData
            });
        } else {
            const waitTimeLeft = REAL_BO_WAIT_TIME - (timeInSeconds - REAL_BO_FULL_TIME);
            io.emit('bo_time_update', {
                time_left: waitTimeLeft,
                status: 'WAITING',
                ...adminData
            });
        }
    }, 1000);
}

async function resetGame_REAL_BO_Round() {

    let closePrice = 0;
    let fairResult = 'BO_MUA';

    let totalBet_MUA = 0;
    let totalBet_BAN = 0;
    if (pending_REAL_BO_Result) {
        for (const userId in game_REAL_BO_Bets) {
            for (const bet of game_REAL_BO_Bets[userId]) {
                if (bet.betType === 'BO_MUA') totalBet_MUA += bet.betAmount;
                else if (bet.betType === 'BO_BAN') totalBet_BAN += bet.betAmount;
            }
        }
    }

    if (bo_round_open_price > 0) {
        closePrice = await getBinancePrice(bo_round_symbol);
        if (closePrice > bo_round_open_price) {
            fairResult = 'BO_MUA';
        } else if (closePrice < bo_round_open_price) {
            fairResult = 'BO_BAN';
        } else {
            if (totalBet_MUA > 0 || totalBet_BAN > 0) {
                fairResult = (totalBet_MUA <= totalBet_BAN) ? 'BO_MUA' : 'BO_BAN';
            }
        }
    } else {
        fairResult = (Math.random() < 0.5) ? 'BO_MUA' : 'BO_BAN';
    }

    let finalResultObject;

    if (pending_REAL_BO_Result === null) {
        finalResultObject = getResultData_REAL_BO(fairResult);
    } else {
        finalResultObject = pending_REAL_BO_Result;
    }

    let payoutUsers = [];
    let roundHouseProfit = 0;

    for (const userId in game_REAL_BO_Bets) {
        const user = findUser('id', parseInt(userId));
        if (!user) continue;
        let totalWinAmount = 0;
        let totalBetOnRound = 0;
        const userBetsArray = game_REAL_BO_Bets[userId];
        for (const bet of userBetsArray) {
            totalBetOnRound += bet.betAmount;
            bet.resultNumber = finalResultObject.result;
            if (checkWin_REAL_BO(bet.betType, finalResultObject)) {
                bet.status = 'WIN';
                const multiplier = getMultiplier_REAL_BO(bet.betType);
                const payoutAmount = bet.betAmount * multiplier;
                bet.payout = (payoutAmount) - bet.betAmount;
                user.balance = parseFloat((user.balance + payoutAmount).toFixed(4));
                totalWinAmount += payoutAmount;
            } else {
                bet.status = 'LOSE';
                bet.payout = -bet.betAmount;
            }
            roundHouseProfit -= bet.payout;
        }

        const netProfit = totalWinAmount - totalBetOnRound;
        if (!user.boProfit) user.boProfit = 0;
        user.boProfit = parseFloat((user.boProfit + netProfit).toFixed(4));
        if (user.boProfit < 0) user.boProfit = 0;

        if (netProfit > 0) {
            payoutUsers.push({ userId: user.id, amount: netProfit, type: 'WIN', betType: userBetsArray.map(b => b.betType).join(', ') });
        } else if (netProfit < 0) {
            payoutUsers.push({ userId: user.id, amount: Math.abs(netProfit), type: 'LOSE', betType: userBetsArray.map(b => b.betType).join(', ') });
        }
    }

    game_REAL_BO_History.push(finalResultObject);
    if (game_REAL_BO_History.length > 50) game_REAL_BO_History.shift();
    allData.boHistory = game_REAL_BO_History;

    allData.boGameBank = (allData.boGameBank || 0) + roundHouseProfit;

    await saveData();

    io.emit('bo_game_result_public', {
        result: finalResultObject.result,
        history: game_REAL_BO_History.slice(-30)
    });

    payoutUsers.forEach(p => {
        const user = findUser('id', p.userId);
        if (user) {
            io.to(`user_${p.userId}`).emit('user_data_update', { balance: user.balance, lastPayout: p });
        }
        if (p.type === 'WIN' && p.amount > 0) {
            io.emit('new_win_notification', {
                username: user ? user.username : 'User',
                amount: p.amount,
                currency: 'USDT'
            });
        }
    });

    pending_REAL_BO_Result = null;
    pending_REAL_BO_Payouts = [];
    bo_round_open_price = 0;

    game_REAL_BO_Countdown = REAL_BO_FULL_TIME;
    game_REAL_BO_Status = 'OPEN';
    game_REAL_BO_Bets = {};
    game_REAL_BO_RoundId++;

    broadcastAdminStats();

    const updateData = {
        status: 'OPEN',
        time_left: game_REAL_BO_Countdown,
        history: game_REAL_BO_History.slice(-30),
        round_id: game_REAL_BO_RoundId
    };

    io.emit('bo_game_update', updateData);
}

// ==============================================
// [KẾT THÚC SỬA]
// ==============================================


// **********************************************
// LOGIC GAME "NHẢY DÙ" (CRASH) [LOGIC THEO GIỜ] (Giữ nguyên)
// **********************************************
const CRASH_WAIT_TIME = 10;
const CRASH_END_TIME = 3;

// [SỬA] Thêm helper
function randomInRange(min, max) {
    return parseFloat((Math.random() * (max - min) + min).toFixed(2));
}

const BOT_NAMES = [
    "bomayvip", "tusenna99", "taixiulon", "huynhde", "kimcuong", "vodich123", "caythuocla",
    "anhemoi", "thanglong88", "proplayerr", "ga_moi_vao", "daigia88", "phuonglinh", "minhtuan99",
    "rong_vang", "hoang_tu_gio", "bancuatoi", "thanh_cong", "vua_loc", "ong_trum", "chienthan99",
    "batbai68", "locphat", "vinhquang", "anhhungxa", "nguoimoi", "daicatutong", "ongtrumtaixiu",
    "sieucao", "thanbai"
];
let crashGame = {
    state: 'WAITING', multiplier: 1.00, crashPoint: 0,
    startTime: 0, countdown: CRASH_WAIT_TIME,
    allActivePlayers: {}, allCashedOutPlayers: {},
    mode: 'auto' // Chế độ hiện tại: 'auto', 'manual', 'anti-majority'
};
let crashGameTimer = null;
function getVietnamHour() {
    const now = new Date();
    const vnTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
    return vnTime.getHours();
}
// [SỬA] Logic mồi (Bait) mới
function calculateBaitCrashPoint() {
    const r = Math.random();

    if (r < 0.50) { // 50% chance
        return parseFloat((1.00 + Math.random() * 0.99).toFixed(2)); // 1.00 - 1.99
    } else if (r < 0.85) { // 35% chance
        return parseFloat((2.00 + Math.random() * 8.00).toFixed(2)); // 2.00 - 10.00
    } else if (r < 0.95) { // 10% chance
        return parseFloat((10.00 + Math.random() * 40.00).toFixed(2)); // 10.00 - 50.00
    } else if (r < 0.99) { // 4% chance
        return parseFloat((50.00 + Math.random() * 50.00).toFixed(2)); // 50.00 - 100.00
    } else { // 1% chance
        return parseFloat((100.00 + Math.random() * 100.00).toFixed(2)); // 100.00 - 200.00 (Giảm từ 1000x)
    }
}
// [SỬA] Logic hồi vốn (Recovery)
function calculateRecoveryCrashPoint(totalBetAmount) {
    const r = Math.random();
    if (r < 0.65) {
        return parseFloat((1.00 + Math.random() * 0.1).toFixed(2)); // 1.00 - 1.10
    }
    return parseFloat((1.11 + Math.random() * 8.89).toFixed(2)); // 1.11 - 10.00
}
// [SỬA] Logic động (Dynamic)
function calculateDynamicCrashPoint(totalPlayers, totalRealBet, currentGameBank) {
    if (totalPlayers === 0) {
        return calculateBaitCrashPoint(); // Dùng 'mồi' nếu không có ai chơi
    }
    if (currentGameBank < 0) {
        return calculateRecoveryCrashPoint(totalRealBet); // Ưu tiên hồi vốn
    }
    const dangerousBetThreshold = currentGameBank * 0.3;
    if (totalRealBet > dangerousBetThreshold && currentGameBank > 0) {
        return calculateRecoveryCrashPoint(totalRealBet); // Hồi vốn nếu cược quá lớn
    }

    // Logic 'bịp' mặc định khi có người chơi và bank an toàn
    const r = Math.random();
    if (r < 0.65) { // 65% chance
        return parseFloat((1.00 + Math.random() * 0.99).toFixed(2)); // 1.00 - 1.99
    }
    else if (r < 0.90) { // 25% chance
        return parseFloat((2.00 + Math.random() * 8.0).toFixed(2)); // 2.00 - 10.00
    }
    else if (r < 0.98) { // 8% chance
        return parseFloat((10.00 + Math.random() * 40.0).toFixed(2)); // 10.00 - 50.00
    }
    else { // 2% chance
        return parseFloat((50.00 + Math.random() * 50.0).toFixed(2)); // 50.00 - 100.00
    }
}

function generateBots(crashPoint) {
    const botCount = Math.floor(Math.random() * (200 - 75 + 1)) + 75;
    let botBets = {};
    const winPercentage = 0.75;
    const MAX_BOT_BET = 500.00;

    // Chia dải tiền cược để bot trông "thật" hơn (đa số nhỏ, ít lệnh rất to)
    const pickBotBet = (max) => {
        const r = Math.random();
        let amount;
        if (r < 0.6) {
            // 60%: cược nhỏ 0.5 - 20 USDT
            amount = 0.5 + Math.random() * 19.5;
        } else if (r < 0.9) {
            // 30%: cược vừa 20 - 100 USDT
            amount = 20 + Math.random() * 80;
        } else {
            // 10%: cược lớn 100 - max
            amount = 100 + Math.random() * Math.max(0, max - 100);
        }
        return parseFloat(amount.toFixed(2));
    };

    for (let i = 0; i < botCount; i++) {
        const botId = `bot_${i}`;
        const botName = `${BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)]}***${Math.floor(Math.random() * 1000)}`;
        botBets[botId] = {};
        const betAmount1 = pickBotBet(MAX_BOT_BET);
        let cashOutPoint1;
        if (Math.random() < winPercentage) {
            const maxWinPoint = Math.max(1.1, crashPoint * 0.98);
            cashOutPoint1 = 1.1 + Math.random() * (maxWinPoint - 1.1);
        } else {
            cashOutPoint1 = (crashPoint * 1.05) + Math.random() * (crashPoint / 2);
        }
        botBets[botId]['1'] = {
            betAmount: betAmount1, username: botName,
            avatar: `https://robohash.org/${botName}.png?set=set4&size=40x40`,
            isBot: true, cashOutPoint: parseFloat(cashOutPoint1.toFixed(2)),
            state: 'RUNNING'
        };
        if (Math.random() < 0.5) {
            const betAmount2 = pickBotBet(MAX_BOT_BET / 2);
            let cashOutPoint2;
            if (Math.random() < winPercentage) {
                const maxWinPoint = Math.max(1.1, crashPoint * 0.98);
                cashOutPoint2 = 1.1 + Math.random() * (maxWinPoint - 1.1);
            } else {
                cashOutPoint2 = (crashPoint * 1.05) + Math.random() * (crashPoint / 2);
            }
            botBets[botId]['2'] = {
                betAmount: betAmount2, username: botName,
                avatar: `https://robohash.org/${botName}.png?set=set4&size=40x40`,
                isBot: true, cashOutPoint: parseFloat(cashOutPoint2.toFixed(2)),
                state: 'RUNNING'
            };
        }
    }
    return botBets;
}
// [SỬA] Thêm current_mode
function broadcastCrashUpdate() {
    let playerBets = {};
    for (const userId in crashGame.allActivePlayers) {
        if (!playerBets[userId]) playerBets[userId] = {};
        for (const panelId in crashGame.allActivePlayers[userId]) {
            const bet = crashGame.allActivePlayers[userId][panelId];
            playerBets[userId][panelId] = {
                state: bet.state, amount: bet.betAmount,
                isCashedOut: false, isBot: bet.isBot
            };
        }
    }
    for (const userId in crashGame.allCashedOutPlayers) {
        if (!playerBets[userId]) playerBets[userId] = {};
        for (const panelId in crashGame.allCashedOutPlayers[userId]) {
            const bet = crashGame.allCashedOutPlayers[userId][panelId];
            playerBets[userId][panelId] = {
                state: 'CASHED_OUT', amount: bet.betAmount,
                cashOutAt: bet.cashOutAt, isCashedOut: true, isBot: bet.isBot
            };
        }
    }
    io.emit('crash_update', {
        state: crashGame.state, countdown: crashGame.countdown,
        multiplier: crashGame.multiplier, playerBets: playerBets,
        allActivePlayers: crashGame.allActivePlayers,
        allCashedOutPlayers: crashGame.allCashedOutPlayers,
        current_mode: current_CRASH_Mode // <-- [THÊM DÒNG NÀY]
    });
}
function runWaitingState() {
    crashGame.state = 'WAITING';
    crashGame.multiplier = 1.00;
    forceCrashNow = false;
    crashGame.countdown = CRASH_WAIT_TIME;
    const tempCrashPoint = calculateBaitCrashPoint();
    crashGame.tempCrashPoint = tempCrashPoint;
    const allBotBets = generateBots(tempCrashPoint);
    const botIdsToAdd = Object.keys(allBotBets);
    crashGame.allActivePlayers = {};
    crashGame.allCashedOutPlayers = {};
    let botAddTimer = null;
    const addBotChunk = () => {
        if (crashGame.state !== 'WAITING' || botIdsToAdd.length === 0) {
            if (botAddTimer) clearTimeout(botAddTimer);
            botAddTimer = null;
            return;
        }
        const chunkAmount = Math.floor(Math.random() * 5) + 1;
        for (let i = 0; i < chunkAmount; i++) {
            const botId = botIdsToAdd.shift();
            if (botId) {
                crashGame.allActivePlayers[botId] = allBotBets[botId];
            } else {
                break;
            }
        }
        const nextInterval = Math.random() * 500 + 200;
        botAddTimer = setTimeout(addBotChunk, nextInterval);
    };
    addBotTimer = setTimeout(addBotChunk, 100);
    crashGameTimer = setInterval(() => {
        broadcastCrashUpdate();
        crashGame.countdown--;
        if (crashGame.countdown < 0) {
            clearInterval(crashGameTimer);
            if (botAddTimer) clearTimeout(botAddTimer);
            runRunningState();
        }
    }, 1000);
}

// [THAY THẾ TOÀN BỘ HÀM NÀY]
function runRunningState() {
    crashGame.state = 'RUNNING';
    crashGame.startTime = Date.now();
    forceCrashNow = false;

    // 1. PHÂN TÍCH NGƯỜI CHƠI
    let totalRealPlayers = 0;
    let totalRealBetAmount = 0; // Tổng tiền cược của người thật
    let hasWhaleBet = false;

    // Lấy ngưỡng cắt lỗ từ cài đặt (mặc định 500 USDT nếu chưa set)
    const LOSS_RECOVERY_THRESHOLD = allData.settings.maxLossThreshold || 500;

    // Lấy tổng Lãi/Lỗ hiện tại của Sàn (Tính All-time để an toàn nhất)
    const currentHouseStats = calculateGameProfitLoss();
    const houseTotalProfit = currentHouseStats.total.profitAllTime;

    for (const userId in crashGame.allActivePlayers) {
        if (userId.startsWith('bot_')) continue; // Bỏ qua bot

        const user = findUser('id', parseInt(userId));
        if (!user) continue;

        let userBetAmount = 0;
        const userBets = crashGame.allActivePlayers[userId];
        if (userBets['1'] && !userBets['1'].isBot) userBetAmount += userBets['1'].betAmount;
        if (userBets['2'] && !userBets['2'].isBot) userBetAmount += userBets['2'].betAmount;

        if (userBetAmount > 0) {
            totalRealPlayers++;
            totalRealBetAmount += userBetAmount;
            // Kiểm tra cá voi (Cược > ngưỡng quy định hoặc > 100$)
            if (userBetAmount >= (global.WHALE_BET_THRESHOLD || 100)) {
                hasWhaleBet = true;
            }
        }
    }

    // 2. QUYẾT ĐỊNH ĐIỂM NỔ (CRASH POINT)

    // ƯU TIÊN 1: Can thiệp thủ công (Admin ra lệnh trực tiếp từ Panel)
    if (next_Crash_Intervention && next_Crash_Intervention.mode === 'manual') {
        crashGame.crashPoint = next_Crash_Intervention.multiplier;
        next_Crash_Intervention = null;
    }
    else if (nextManualCrash) {
        crashGame.crashPoint = nextManualCrash;
        nextManualCrash = null;
    }
    // ƯU TIÊN 2: LOGIC TỰ ĐỘNG THÔNG MINH (SMART AUTO)
    else {
        const effectiveMode = crashGame.mode || current_CRASH_Mode || 'auto';

        // === KỊCH BẢN A: CÓ NGƯỜI CHƠI THẬT ===
        if (totalRealPlayers > 0) {

            // [LOGIC GỠ VỐN] Kích hoạt khi Sàn đang lỗ quá ngưỡng cho phép
            if (houseTotalProfit < -LOSS_RECOVERY_THRESHOLD) {
                // -> Ép nổ cực sớm để thu hồi vốn
                // Range: 1.10x đến 1.45x
                crashGame.crashPoint = randomInRange(1.10, 1.45);
                console.log(`[CRASH] 🚨 GỠ VỐN: Sàn đang âm ${houseTotalProfit.toFixed(2)}$. Ép crash ${crashGame.crashPoint}x`);
            }
            // [LOGIC DIỆT CÁ VOI] Nếu Sàn chưa lỗ, nhưng có Cược Lớn
            else if (hasWhaleBet || totalRealBetAmount > 200) {
                // -> Tăng độ khó để tránh bị ăn to
                // Range: 1.00x đến 1.50x
                crashGame.crashPoint = randomInRange(1.00, 1.50);
                console.log(`[CRASH] 🐋 DIỆT CÁ VOI: Tổng cược ${totalRealBetAmount}$. Ép crash ${crashGame.crashPoint}x`);
            }
            // [LOGIC AUTO THƯỜNG] Chế độ bình thường hoặc Anti-player
            else if (effectiveMode === 'auto' || effectiveMode === 'anti-player') {
                const r = Math.random();
                if (r < 0.60) {
                    // 60% Tỉ lệ: Ăn non (1.10x - 1.90x) -> Khó x2
                    crashGame.crashPoint = randomInRange(1.10, 1.90);
                } else if (r < 0.85) {
                    // 25% Tỉ lệ: Ăn vừa (2.00x - 3.50x)
                    crashGame.crashPoint = randomInRange(2.00, 3.50);
                } else {
                    // 15% Tỉ lệ: Nhả (Thả cho user ăn để dụ)
                    crashGame.crashPoint = randomInRange(3.50, 10.00);
                }
                console.log(`[CRASH] 🤖 SMART AUTO: ${totalRealPlayers} khách. Crash ${crashGame.crashPoint}x`);
            }
            // Các mode khác (Pro-player/Extreme) giữ nguyên logic cũ...
            else {
                // Fallback an toàn
                crashGame.crashPoint = randomInRange(1.10, 2.00);
            }
        }

        // === KỊCH BẢN B: KHÔNG CÓ NGƯỜI CHƠI (CHỈ CÓ BOT) ===
		// [CẬP NHẬT: Chế độ "Thả Mồi Siêu Cấp" - Gãy chỉ 40%]
		else {
			const r = Math.random();

			if (r < 0.40) {
				// 40% Cơ hội: Nổ dưới 2.00x
				// (Tỉ lệ gãy thấp, cứ 10 ván thì chỉ có 4 ván đỏ)
				crashGame.crashPoint = randomInRange(1.00, 1.99);
			}
			else if (r < 0.83) {
				// 43% Cơ hội: Nổ từ 2.00x đến 10.00x (0.40 + 0.43 = 0.83)
				// (Đây là tỉ lệ cao nhất: Tạo cảm giác game cực kỳ ổn định, dễ x2 tài khoản)
				crashGame.crashPoint = randomInRange(2.00, 10.00);
			}
			else if (r < 0.95) {
				// 12% Cơ hội: Nổ từ 10.00x đến 50.00x (0.83 + 0.12 = 0.95)
				// (Thỉnh thoảng nổ to để kích thích lòng tham)
				crashGame.crashPoint = randomInRange(10.00, 50.00);
			}
			else {
				// 5% Cơ hội: Nổ trên 50.00x (Phần còn lại)
				// (Tăng tỉ lệ Jackpot lên 5% để bảng lịch sử thỉnh thoảng có số cực khủng)
				crashGame.crashPoint = randomInRange(50.00, 200.00);
			}
			// console.log(`[CRASH] 🎣 SIÊU THẢ MỒI (No User): ${crashGame.crashPoint}x`);
		}
    }

    // 4. CẬP NHẬT MỤC TIÊU CỦA BOT (Để Bot trông thông minh, biết tránh bão)
    for (const botId in crashGame.allActivePlayers) {
        if (botId.startsWith('bot_')) {
            const bot = crashGame.allActivePlayers[botId];
            // Bot sẽ cố gắng cashout ngay trước điểm nổ một chút
            const safePoint = crashGame.crashPoint * 0.90;

            ['1', '2'].forEach(idx => {
                if (bot[idx]) {
                    // 80% Bot sẽ thắng (né điểm nổ)
                    if (Math.random() < 0.80 && safePoint > 1.1) {
                        // Bot rút ngẫu nhiên từ 1.1 đến safePoint
                        bot[idx].cashOutPoint = parseFloat((1.1 + Math.random() * (safePoint - 1.1)).toFixed(2));
                    } else {
                        // 20% Bot tham và chết (để tạo thanh khoản ảo)
                        bot[idx].cashOutPoint = parseFloat((crashGame.crashPoint + Math.random() * 2).toFixed(2));
                    }
                }
            });
        }
    }

    // 5. CHẠY GAME (Bắt đầu đếm giờ bay)
    for (const userId in crashGame.allActivePlayers) {
        const user = crashGame.allActivePlayers[userId];
        if (user['1'] && !user['1'].isBot) user['1'].state = 'RUNNING';
        if (user['2'] && !user['2'].isBot) user['2'].state = 'RUNNING';
    }

    crashGameTimer = setInterval(() => {
        // Kiểm tra xem Admin có bấm nút "Nổ Ngay" không
        if (forceCrashNow) {
            clearInterval(crashGameTimer);
            crashGame.multiplier = Math.max(1.00, crashGame.multiplier - 0.01);
            crashGame.crashPoint = crashGame.multiplier;
            forceCrashNow = false;
            runCrashedState();
            return;
        }

        // Tốc độ bay: 0.06 là tốc độ tiêu chuẩn
        const timeElapsed = (Date.now() - crashGame.startTime) / 1000;
        crashGame.multiplier = Math.pow(Math.E, 0.06 * timeElapsed);

        // Kiểm tra điều kiện nổ
        if (crashGame.multiplier >= crashGame.crashPoint) {
            clearInterval(crashGameTimer);
            crashGame.multiplier = crashGame.crashPoint;
            runCrashedState();
            return;
        }

        // Logic Cashout cho Bot (Giả lập)
        for (const botId in crashGame.allActivePlayers) {
            const bot = crashGame.allActivePlayers[botId];
            ['1', '2'].forEach(idx => {
                if (bot[idx] && bot[idx].state === 'RUNNING' && crashGame.multiplier >= bot[idx].cashOutPoint) {
                    const wonAmount = bot[idx].betAmount * crashGame.multiplier;
                    if (!crashGame.allCashedOutPlayers[botId]) crashGame.allCashedOutPlayers[botId] = {};

                    // Di chuyển bot sang danh sách đã rút tiền
                    crashGame.allCashedOutPlayers[botId][idx] = {
                        ...bot[idx], cashOutAt: crashGame.multiplier,
                        won: wonAmount, state: 'CASHED_OUT'
                    };
                    delete crashGame.allActivePlayers[botId][idx];
                }
            });
            // Dọn dẹp object rỗng
            if (Object.keys(crashGame.allActivePlayers[botId]).length === 0) {
                delete crashGame.allActivePlayers[botId];
            }
        }

        // Gửi cập nhật cho tất cả client (để vẽ máy bay)
        broadcastCrashUpdate();
    }, 100); // Cập nhật mỗi 100ms
}

async function runCrashedState() {
    crashGame.state = 'CRASHED';
    const finalCrashPoint = crashGame.multiplier;
    broadcastCrashUpdate();
    crashGameHistory.push({ crashPoint: finalCrashPoint });
    if (crashGameHistory.length > 20) crashGameHistory.shift();
    for (const userId in crashGame.allActivePlayers) {
        const userBets = crashGame.allActivePlayers[userId];
        if (userBets['1']?.isBot || userBets['2']?.isBot) continue;
        if (userBets['1'] && userBets['1'].state === 'RUNNING') {
            logCrashBet(parseInt(userId), userBets['1'], finalCrashPoint, 'LOSE');
            gameBank += userBets['1'].betAmount;
        }
        if (userBets['2'] && userBets['2'].state === 'RUNNING') {
            logCrashBet(parseInt(userId), userBets['2'], finalCrashPoint, 'LOSE');
            gameBank += userBets['2'].betAmount;
        }
    }
    broadcastAdminStats();
    await saveData();
    io.emit('crash_history', crashGameHistory);
    setTimeout(() => {
        runWaitingState();
    }, 3000);
}
function logCrashBet(userId, bet, multiplier, status) {
    const profit = (status === 'WIN') ? (bet.betAmount * multiplier) - bet.betAmount : -bet.betAmount;
    const resultText = (status === 'WIN') ? `Nhảy@${multiplier.toFixed(2)}x` : `Nổ@${multiplier.toFixed(2)}x`;
    const newLog = {
        betId: allData.allBets.length + 1,
        userId: userId, username: bet.username,
        betAmount: bet.betAmount, betType: 'CRASH',
        placedAt: new Date(crashGame.startTime).toISOString(),
        status: status, payout: profit, resultNumber: resultText
    };
    allData.allBets.push(newLog);
}
function startCrashGameLoop() {
    runWaitingState();
}

// ==========================================================
// [MỚI] KHU VỰC LOGIC BOT CHAT TỰ ĐỘNG (HYBRID V5)
// ==========================================================

// --- 1. CẤU HÌNH BOT ---
const BOT_AVATARS = ['😎', '🤑', '💰', '🎰', '🎲', '🔥', '💎', '⭐', '🚀', '💸', '🎯', '👊', '😈', '🤩', '🥳', '😤'];
const LEADER_BOTS = [
    { username: 'ThầyCầu_VIP', isLeader: true },
    { username: 'ProTrader88', isLeader: true },
    { username: 'MasterLệnh', isLeader: true }
];
// [MỚI] Thêm HÀNG TRĂM TỪ VỰNG
const FOLLOWER_NAMES = [
    'bomayvip', 'tusenna99', 'taixiulon', 'huynhde', 'kimcuong', 'vodich123', 'caythuocla', 'anhemoi', 'thanglong88', 'proplayerr',
    'ga_moi_vao', 'daigia88', 'phuonglinh', 'minhtuan99', 'rong_vang', 'hoang_tu_gio', 'bancuatoi', 'thanh_cong', 'vua_loc', 'ong_trum',
    'chienthan99', 'batbai68', 'locphat', 'vinhquang', 'anhhungxa', 'nguoimoi', 'daicatutong', 'ongtrumtaixiu', 'sieucao', 'thanbai'
];
const FOLLOWER_ACTIONS = [
    'Theo thầy', 'Vào lệnh', 'All-in', 'Theo leader', 'Húp', 'Vào 500k', 'OK thầy', 'Đã theo', 'Vào 1 củ', 'Tin tưởng',
    'Vào mạnh', 'Chắc ăn', 'Uy tín', 'Chuẩn thầy', 'Làm nhẹ', 'Theo ngay', 'Tin thầy', 'Đánh', 'Chốt', 'Húp mạnh',
    'Theo 200k', 'Chốt lệnh', 'Làm 1m', 'Vào', 'OK sếp', 'Triển', 'Múc', 'Quất', 'Húp'
];
const FOLLOWER_COMMENTS = [
    'luôn', 'rồi ae', 'tay này', 'nhé', 'chắc rồi', 'với thầy', 'luôn ae ơi', 'nào', 'chứ sợ gì', 'nhẹ', 'nhanh', 'gấp', 'mạnh',
    'thôi', 'kịp ko', 'vào', 'húp húp', 'chắc cú', 'tin tưởng 100%', 'gỡ vốn', 'về bờ'
];
const CHATTER_NAMES = [
    'ditmenhacai', 'cau_tai_xiu', 'than_bai_online', 'gobac88', 'chuyen_gia_doc_nen', 'ong_hoang_bo', 'thanh_nu_phu_ho', 'vua_crash',
    'nguoiquaduong', 'laobu', 'thanhniennghien', 'onggia', 'bachuso', 'sinhvien', 'nhanvienvp'
];
const CHATTER_MESSAGES = [
    'Đang đỏ, ae theo tôi bẻ cầu không?', 'mạng lag vãi, lag thế này trade sao', 'ad đâu, cho xin cái code tân thủ với', 'Đen vãi. Thôi đi ngủ',
    'bác nào hô lẻ lúc nãy uy tín vãi', 'Tí làm ván Mines gỡ mới được', 'đm lag à? mạng mỉo chán vcl', 'ae đừng all-in, admin nó soi đấy',
    'cầu bệt chẵn 4 tay r, bẻ lẻ thôi', 'ai có kinh nghiệm chơi Crash ko?', 'Toang. lại sắp ra đảo', 'nạp vào 1 triệu đánh lên 3 củ rồi ae ạ',
    'Game 1-20 dễ chơi thật', 'Mấy game mới ra cuốn vãi', 'Game HiLo khó đoán thật', 'Bẻ cầu hay thuận cầu ae?', 'Hôm qua húp 10 củ, nay trả lại 5 củ',
    'Có ai rút tiền về bank nhanh không?', 'Nạp tiền 1 phút vào ngay, uy tín', 'Sao KYC của tôi chờ lâu thế admin?', 'Game BO nến giật quá',
    'Đang có chuỗi thắng 5 tay BO', 'Ai theo tui tay này BÁN không?', 'Bitcoin sắp sập à ae?', 'Ngon, vừa húp x50 game Crash',
    'Dò mìn 10 mìn khó vãi', 'Ae chơi dò mìn toàn đi mấy ô à?', 'Vòng quay may mắn có ai trúng to chưa?', 'Game 1-20 cầu 1-1 đẹp vãi',
    'làm sao để lên VIP nhanh?', 'mất 3 củ rồi, chán vãi', 'lại sắp hết tiền', 'nay ai húp không cafe tôi với', 'vừa nạp 5 lít gỡ',
    'chơi game gì dễ ăn nhất ae?', 'web này có uy tín 100% ko ae?', 'rút tiền 5 phút về bank rồi, nhanh thật', 'có ai ở HN ko?', 'vcl cầu 1-2-1',
    'thầy hô chuẩn vãi', 'theo thầy gãy 2 tay rồi :(', 'ai có link nhóm telegram ko cho xin với', 'Crash vừa nổ 1.01x, cay'
];
const LEADER_GAMES = ['Game 1-20', 'Game BO'];
const LEADER_CALLS_120 = ['CHẴN', 'LẺ'];
const LEADER_CALLS_BO = ['MUA', 'BÁN'];
const LEADER_COMMENTS = [
    'Tín hiệu này thầy soi kỹ lắm rồi.', 'Ae gấp thếp tay này nhé.', 'Cầu này chắc chắn 99%.', 'Vào mạnh cho thầy.',
    'Chờ tín hiệu này từ sáng.', 'Không húp không lấy tiền.', 'Tự tin vào lệnh!', 'Tay này gỡ lại cả vốn lẫn lãi.',
    'Ae nghe rõ lệnh rồi vào nhé.', 'Cầu đẹp, đừng bỏ lỡ.', 'Vào lệnh dứt khoát!', 'Chỉ ae cách quản lý vốn.'
];
const LEADER_RESULTS_WIN = [
    '✅ HÚP! Thầy đã bảo mà.', '✅ Chuẩn! Lãi +${profit}!', '✅ Lại một tay húp. Quá đơn giản.', '✅ Ae nào theo tay này điểm danh.',
    '✅ +${profit}! Chúc mừng ae theo.'
];
const LEADER_RESULTS_LOSE = [
    '❌ Gãy! Cầu lừa.', '❌ Không sao, gãy 1 tay.', '❌ Tay này soi lỗi, ae bình tĩnh.', '❌ Đen. Cầu xấu quá.', '❌ Gãy. Tay sau làm lại.'
];

// --- 2. BIẾN TRẠNG THÁI TOÀN CỤC ---
let simLeaderState = {
    isSpeaking: false,
    winStreak: 0,
    currentBetPercent: 1
};
let currentChatShift = 'Đêm';
let currentShiftStats = { bets: 0, wins: 0, losses: 0, profit: 0 };
let simulatedOnlineCount = 200;
let hasClearedThisMonth = false;

// --- 3. CÁC HÀM HELPER ---

// Lấy giờ VN (GMT+7)
function getVietnamHour() {
    const now = new Date();
    const offset = 7; // GMT+7
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    return new Date(utc + (3600000 * offset)).getHours();
}

// [MỚI] Phân chia 6 ca
function getShift(hour) {
    if (hour >= 5 && hour < 11) return 'Sáng';   // 5:00 - 10:59
    if (hour >= 11 && hour < 14) return 'Trưa';  // 11:00 - 13:59
    if (hour >= 14 && hour < 17) return 'Chiều'; // 14:00 - 16:59
    if (hour >= 17 && hour < 20) return 'Lỡ';   // 17:00 - 19:59
    if (hour >= 20 && hour < 24) return 'Tối';   // 20:00 - 23:59
    return 'Đêm'; // 00:00 - 4:59
}

// [MỚI] Random chữ hoa/thường chữ cái đầu
function randomCaps(str) {
    if (Math.random() < 0.5) {
        return str.charAt(0).toLowerCase() + str.slice(1);
    }
    return str.charAt(0).toUpperCase() + str.slice(1);
}

// [MỚI] Tính số người online giả
function getSimulatedOnlineCount() {
    const hour = getVietnamHour();
    let min, max;

    if (hour >= 20 && hour <= 23) { // Giờ VÀNG (Tối)
        min = 700; max = 1000;
    } else if (hour >= 3 && hour < 7) { // Giờ THẤP (Sáng sớm)
        min = 54; max = 150;
    } else if (hour >= 11 && hour < 14) { // Giờ Trưa
        min = 300; max = 600;
    } else { // Giờ Thường
        min = 200; max = 500;
    }
    simulatedOnlineCount = Math.floor(Math.random() * (max - min + 1)) + min;
    return simulatedOnlineCount;
}

// [MỚI] Phát số người online giả
function broadcastChatUserCount() {
    const count = getSimulatedOnlineCount();
    io.emit('chat_user_count', count);
}

// Hàm helper tạo tin nhắn bot và phát
async function broadcastBotMessage(msgData) {
    const newChat = {
        id: (allData.globalChat.length || 0) + 1,
        userId: 0, // 0 = Bot
        username: msgData.username,
        message: msgData.message,
        isImage: false,
        isLeader: msgData.isLeader || false,
        timestamp: new Date().toISOString()
    };
    if (!allData.globalChat) allData.globalChat = [];
    allData.globalChat.push(newChat);
    if (allData.globalChat.length > 200) { // Giữ 200 tin nhắn
        allData.globalChat.shift();
    }
    await saveData(); // Không cần đợi
    io.emit('chat_message_broadcast', newChat); // Phát cho mọi người
}

// --- 4. LOGIC BOT CHÍNH ---

// [MỚI] Thông báo bắt đầu ca
function postNewShiftAnnouncement(newShift) {
    const welcomeMsg = `
📣 [THÔNG BÁO] CHÍNH THỨC VÀO CA ${newShift.toUpperCase()} 📣
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Chúc ae một ca mới rực rỡ!
Leader sẽ sớm lên lệnh, ae chuẩn bị vốn.
`;
    broadcastBotMessage({
        username: 'Hệ Thống',
        message: welcomeMsg,
        isLeader: true
    });
}

// [MỚI] Báo cáo Lãi/Lỗ cuối ca
async function postShiftReport(oldShift, stats) {
    // Lấy P/L thật từ server
    const housePL = (await calculateGameProfitLoss()).total.profit24h;

    let status = stats.profit >= 0 ? "LÃI" : "LỖ";
    let icon = stats.profit >= 0 ? "✅" : "❌";
    let comment = "";

    if (stats.profit > 200) comment = "Ca này rực rỡ, ae húp no!";
    else if (stats.profit > 0) comment = "Ca này húp nhẹ, đủ tiền cafe.";
    else if (stats.profit > -100) comment = "Ca này hơi đen, gãy nhẹ vài tay.";
    else comment = "Cầu chạy láo quá, gãy sâu. Ae ca sau gỡ lại!";

    const totalBets = stats.bets;
    const winBets = stats.wins;
    const loseBets = stats.losses;
    const winRate = totalBets > 0 ? ((winBets / totalBets) * 100).toFixed(0) : 0;

    const reportMsg = `
📊 BÁO CÁO CA ${oldShift.toUpperCase()} 📊
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📖 CHI TIẾT CA (Mô phỏng):
    Tổng Lệnh:    ${totalBets}
    Lệnh Thắng:   ${winBets}
    Lệnh Thua:    ${loseBets}
    Tỷ Lệ Thắng:  ${winRate}%
💰 TỔNG KẾT CA (Mô phỏng): ${icon} ${status} ${Math.abs(stats.profit).toFixed(2)} USDT

💰 LÃI/LỖ SERVER 24H (Thực tế):
    ${housePL >= 0 ? '+' : ''}${housePL.toFixed(2)} USDT

💬 ${comment}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

    broadcastBotMessage({
        username: 'KingPredict',
        message: reportMsg,
        isLeader: true
    });

    // Reset dữ liệu ca
    currentShiftStats = { bets: 0, wins: 0, losses: 0, profit: 0 };
    simLeaderState.winStreak = 0; // Reset chuỗi
    simLeaderState.currentBetPercent = 1;
}

// [MỚI] Quản lý ca (chạy 5p/lần)
function manageShifts() {
    const hour = getVietnamHour();
    const newShift = getShift(hour);

    if (newShift !== currentChatShift) {
        postShiftReport(currentChatShift, currentShiftStats); // Báo cáo ca CŨ
        currentChatShift = newShift; // Cập nhật ca MỚI
        postNewShiftAnnouncement(currentChatShift); // Thông báo ca MỚI
    }
}

// [MỚI] Bot Chatter (Linh hoạt theo số người)
function simulateChatter() {
    if (simLeaderState.isSpeaking) {
        setTimeout(simulateChatter, 10000 + Math.random() * 10000); // Nếu leader nói, chờ 10-20s
        return;
    }

    // 50% cơ hội chatter sẽ nói
    if (Math.random() < 0.5) {
        const chatterName = CHATTER_NAMES[Math.floor(Math.random() * CHATTER_NAMES.length)];
        const chatterMsg = CHATTER_MESSAGES[Math.floor(Math.random() * CHATTER_MESSAGES.length)];

        broadcastBotMessage({
            username: chatterName,
            // [MỚI] Random chữ hoa/thường
            message: randomCaps(chatterMsg),
            isLeader: false
        });
    }

    // [MỚI] Tần suất linh hoạt
    const onlineCount = simulatedOnlineCount;
    // 1000 người: 60s / (1000/50) = 3s
    // 100 người: 60s / (100/50) = 30s
    // 54 người: 60s / (54/50) = 55s
    const baseInterval = 60000;
    let dynamicInterval = baseInterval / (onlineCount / 50);

    // Giới hạn (5s - 45s)
    const interval = Math.max(5000, Math.min(45000, dynamicInterval)) + Math.random() * 5000; // + 0-5s
    setTimeout(simulateChatter, interval);
}

// Bot Leader (Hô lệnh)
async function simulateLeaderLogic() {
    if (simLeaderState.isSpeaking) {
        setTimeout(simulateLeaderLogic, 10000); // Chờ 10s nếu đang nói dở
        return;
    }
    simLeaderState.isSpeaking = true;

    // --- Quyết định thắng/thua (Logic bịp) ---
    const housePL = (calculateGameProfitLoss()).total.profit24h; // Phải đảm bảo hàm này đã được định nghĩa
    let willWin = false; // Mặc định USER THUA

    if (housePL < 100) { // Nhà cái lỗ
        willWin = (Math.random() < 0.20); // 20% thắng (Bịp nặng)
    } else if (housePL > 2000) { // Nhà cái lãi to
        willWin = (Math.random() < 0.55); // 55% thắng (Thả mồi)
    } else { // Nhà cái lãi vừa
        willWin = (Math.random() < 0.35); // 35% thắng (Bình thường)
    }

    // --- [SỬA] Chuẩn bị lệnh (Martingale) ---
    if (simLeaderState.winStreak < 0) { // Đang thua
        simLeaderState.currentBetPercent = Math.min(8, Math.pow(2, Math.abs(simLeaderState.winStreak)));
    } else { // Đang thắng (hoặc hòa)
        simLeaderState.currentBetPercent = 1;
    }
    const betPercent = simLeaderState.currentBetPercent;
    const betAdvice = (betPercent > 1) ? `Gấp thếp x${betPercent}` : 'Đi đều x1';

    const leader = LEADER_BOTS[Math.floor(Math.random() * LEADER_BOTS.length)];
    const game = LEADER_GAMES[Math.floor(Math.random() * LEADER_GAMES.length)];
    const call = (game === 'Game BO')
        ? LEADER_CALLS_BO[Math.floor(Math.random() * LEADER_CALLS_BO.length)]
        : LEADER_CALLS_120[Math.floor(Math.random() * LEADER_CALLS_120.length)];
    const comment = LEADER_COMMENTS[Math.floor(Math.random() * LEADER_COMMENTS.length)];

    const callMsg = `
🎯 CA ${currentChatShift.toUpperCase()} - PHIÊN NÀY: ${call}

    Game: ${game}
    Vốn: ${betPercent}% (${betAdvice})

${comment}
Ae vào lệnh!`;

    // A. Hô lệnh (sau 5-10s)
    setTimeout(() => {
        broadcastBotMessage({
            username: leader.username, message: callMsg, isLeader: true
        });
    }, 5000 + Math.random() * 5000);

    // B. Followers vào hùa (sau 8-15s)
    const numFollowers = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < numFollowers; i++) {
        setTimeout(() => {
            const follower = FOLLOWER_NAMES[Math.floor(Math.random() * FOLLOWER_NAMES.length)];
            const action = FOLLOWER_ACTIONS[Math.floor(Math.random() * FOLLOWER_ACTIONS.length)];
            const extra = FOLLOWER_COMMENTS[Math.floor(Math.random() * FOLLOWER_COMMENTS.length)];
            broadcastBotMessage({
                username: follower,
                message: randomCaps(`${action} ${extra}`), // [MỚI] Random chữ hoa
                isLeader: false
            });
        }, 8000 + (i * (1500 + Math.random() * 2000)));
    }

    // C. Công bố kết quả (sau 30s)
    setTimeout(() => {
        let resultMsg = "";
        let profit = (50 * betPercent * 0.95); // Lãi mô phỏng

        if (willWin) {
            profit = parseFloat(profit.toFixed(0));
            if (simLeaderState.winStreak < 0) simLeaderState.winStreak = 1; // Gãy chuỗi thua -> về 1
            else simLeaderState.winStreak++; // Tăng chuỗi thắng

            resultMsg = LEADER_RESULTS_WIN[Math.floor(Math.random() * LEADER_RESULTS_WIN.length)].replace('${profit}', profit);
            resultMsg += `\n\nTuyệt vời! Tay sau quay lại 1% vốn nhé.`;

            // Cập nhật báo cáo
            currentShiftStats.bets++;
            currentShiftStats.wins++;
            currentShiftStats.profit += profit; // Lãi cho nhà cái (Bot thua)

        } else {
            profit = -(50 * betPercent); // Thua mô phỏng
            if (simLeaderState.winStreak > 0) simLeaderState.winStreak = -1; // Gãy chuỗi thắng -> về -1
            else simLeaderState.winStreak--; // Tăng chuỗi thua

            let nextPercent = Math.min(8, Math.pow(2, Math.abs(simLeaderState.winStreak)));
            resultMsg = LEADER_RESULTS_LOSE[Math.floor(Math.random() * LEADER_RESULTS_LOSE.length)];
            resultMsg += `\n\nBình tĩnh! Tay sau GẤP THÉP ${nextPercent}% vốn gỡ lại!`;

            // Cập nhật báo cáo
            currentShiftStats.bets++;
            currentShiftStats.losses++;
            currentShiftStats.profit += profit; // Lỗ cho nhà cái (Bot thắng)
        }

        broadcastBotMessage({
            username: leader.username, message: resultMsg, isLeader: true
        });

        simLeaderState.isSpeaking = false;

        // Chờ 2-4 phút cho lệnh tiếp theo
        const nextCallDelay = 120000 + Math.random() * 120000;
        setTimeout(simulateLeaderLogic, nextCallDelay);

    }, 30000); // 30 giây sau khi hô lệnh
}

// 3. Logic Xóa Chat Hàng Tháng
async function checkMonthlyChatClear() {
    const now = new Date();
    const currentDay = now.getDate();

    if (currentDay === 1 && !hasClearedThisMonth) {
        console.log('🧹 [CRON JOB] Đang thực hiện dọn dẹp tin nhắn chat hàng tháng...');
        allData.globalChat = [];

        const systemMsg = {
            id: 1, userId: 0, username: 'Hệ Thống',
            message: 'Lịch sử trò chuyện đã được dọn dẹp để bắt đầu tháng mới. Chúc ae rực rỡ!',
            isImage: false, isLeader: true, timestamp: new Date().toISOString()
        };
        allData.globalChat.push(systemMsg);
        await saveData();

        io.emit('chat_message_broadcast', systemMsg); // Báo cho mọi người

        hasClearedThisMonth = true; // Đánh dấu đã clear
    } else if (currentDay !== 1) {
        hasClearedThisMonth = false; // Reset cờ
    }
}

// Hàm khởi động tất cả bot
function startChatSimulation() {
    console.log("🤖 Khởi động mô phỏng chat tự động V5...");

    // Lấy ca hiện tại
    currentChatShift = getShift(getVietnamHour());
    postNewShiftAnnouncement(currentChatShift);

    simulateLeaderLogic(); // Bắt đầu vòng lặp Leader
    simulateChatter();     // Bắt đầu vòng lặp Chatter

    // Kiểm tra dọn dẹp 1 giờ 1 lần
    setInterval(checkMonthlyChatClear, 3600000);

    // Quản lý ca (5 phút 1 lần)
    setInterval(manageShifts, 300000);

    // Cập nhật số người online (15s 1 lần)
    setInterval(broadcastChatUserCount, 15000);
}
// ==========================================================
// [HẾT] KHU VỰC LOGIC BOT CHAT TỰ ĐỘNG
// ==========================================================


// [SỬA LỖI] THAY THẾ TOÀN BỘ KHỐI io.on('connection', ...) (từ dòng 4240) BẰNG CODE NÀY

io.on('connection', (socket) => {

    // [SỬA LỖI V5] ĐÃ DI CHUYỂN KHỐI XÁC THỰC LÊN ĐẦU
    // 1. Xác thực Admin / User NGAY LẬP TỨC
    if (socket.handshake.query.admin === "true") {
        socket.join('admin_room');
    }

    const userId = socket.handshake.query.user_id;
    let user = null;
    if (userId) {
        user = findUser('id', parseInt(userId));
        if (user) {
            socket.join(`user_${userId}`);
        }
    }
    // [HẾT SỬA LỖI] - Biến 'user' giờ đã được định nghĩa và có giá trị


    // 2. Lắng nghe tin nhắn mới từ client (real user)
    // (Hàm này giờ sẽ hoạt động vì 'user' đã được định nghĩa ở trên)
    socket.on('chat_message_send', async (data) => {

        if (!user) { // Check này giờ đã chính xác
            socket.emit('chat_error', 'Lỗi: Bạn phải đăng nhập để chat.');
            return;
        }

        const messageText = data.message ? data.message.trim() : '';
        const isImage = data.isImage || false;

        if (!messageText) {
            socket.emit('chat_error', 'Lỗi: Tin nhắn không được để trống.');
            return;
        }

        const newChat = {
            id: (allData.globalChat.length || 0) + 1,
            userId: user.id,
            username: user.username,
            message: messageText,
            isImage: isImage,
            isLeader: user.isAdmin || (user.vipLevel && user.vipLevel >= 5), // VIP 5+ hoặc Admin là Leader
            timestamp: new Date().toISOString()
        };

        if (!allData.globalChat) allData.globalChat = [];
        allData.globalChat.push(newChat);

        if (allData.globalChat.length > 200) { // Giữ 200 tin nhắn
            allData.globalChat.shift();
        }

        await saveData();

        io.emit('chat_message_broadcast', newChat);
        socket.emit('chat_message_ack', newChat.id);
    });

    // 3. [PHẦN CÒN LẠI GIỮ NGUYÊN]
    // Các logic game bắt đầu từ đây

    // --- (Logic Game 40S (1-20)) ---
    const timeSinceEpoch_40S = Date.now();
    const timeIntoCycle_40S = timeSinceEpoch_40S % GAME_40S_CYCLE_MS;
    const timeInSeconds_40S = Math.floor(timeIntoCycle_40S / 1000);
    let initialCountdown_40S = GAME_40S_FULL_TIME - timeInSeconds_40S;
    let status_40S = 'OPEN';
    if (timeInSeconds_40S >= GAME_40S_FULL_TIME) {
        initialCountdown_40S = 0;
        status_40S = 'SHAKE_ANNOUNCE';
    }
    socket.emit('game_40s_update', {
        status: status_40S,
        time_left: initialCountdown_40S,
        history: game_40S_History.slice(-30),
        round_id: game_40S_RoundId
    });

    // --- (Logic Game BO Thật (60s)) ---
    const timeSinceEpoch_BO = Date.now();
    const timeIntoCycle_BO = timeSinceEpoch_BO % REAL_BO_CYCLE_MS;
    const timeInSeconds_BO = Math.floor(timeIntoCycle_BO / 1000);

    let initialCountdown_BO = REAL_BO_FULL_TIME - timeInSeconds_BO;
    let status_BO = 'OPEN';
    let initialTimeLeft_BO = REAL_BO_FULL_TIME;
    let initialStatus_BO = 'OPEN';

    if (timeInSeconds_BO >= REAL_BO_FULL_TIME) {
        initialCountdown_BO = 0;
        status_BO = 'SHAKE_ANNOUNCE';
        initialTimeLeft_BO = REAL_BO_WAIT_TIME - (timeInSeconds_BO - REAL_BO_FULL_TIME);
        initialStatus_BO = 'WAITING';
    } else {
        initialTimeLeft_BO = REAL_BO_FULL_TIME - timeInSeconds_BO;
        initialStatus_BO = 'OPEN';
    }

    socket.emit('bo_game_update', {
        status: status_BO,
        time_left: initialTimeLeft_BO,
        history: game_REAL_BO_History.slice(-30),
        round_id: game_REAL_BO_RoundId
    });

    // [SỬA] Gửi kèm trạng thái can thiệp cho Admin
    const adminData = {
        current_mode: current_BO_Mode,
        next_rig: next_BO_Intervention_Manual ? next_BO_Intervention_Manual.value : null
    };

    socket.emit('bo_time_update', {
        time_left: initialTimeLeft_BO,
        status: initialStatus_BO,
        ...adminData // Gửi kèm
    });



    // [SỬA] Lắng nghe cược (cho game 40S (1-20))
    socket.on('game_40s_place_bet', async (data) => {
        const user = findUser('id', parseInt(data.user_id));
        const betAmount = parseFloat(data.amount);
        const betType = data.type;

        if (!user || game_40S_Status !== 'OPEN') {
            socket.emit('bet_response', { success: false, message: 'Lỗi: Đã đóng cược.' });
            return;
        }
        if (isNaN(betAmount) || betAmount <= 0 || betAmount > user.balance) {
            socket.emit('bet_response', { success: false, message: 'Lỗi: Số tiền cược không hợp lệ hoặc số dư không đủ.' });
            return;
        }
        if (!valid_40S_BetTypes.includes(betType)) {
            socket.emit('bet_response', { success: false, message: 'Lỗi: Cửa cược không hợp lệ.' });
            return;
        }

        user.balance = parseFloat((user.balance - betAmount).toFixed(4));
        await saveData();

        const newBet = {
            betId: allData.allBets.length + 1,
            userId: user.id, username: user.username,
            betAmount: betAmount, betType: betType,
            placedAt: new Date().toISOString(),
            status: 'PENDING', payout: 0, resultNumber: null
        };
        allData.allBets.push(newBet);

        if (!game_40S_Bets[user.id]) {
            game_40S_Bets[user.id] = [];
        }
        game_40S_Bets[user.id].push(newBet);

        // [THÊM ĐOẠN NÀY VÀO 5 HÀM]
        if (betAmount >= (global.WHALE_BET_THRESHOLD || 100)) {
            io.to('admin_room').emit('whale_alert', {
                game: 'Game 1-20',
                username: user.username,
                amount: betAmount
            });
        }

        io.to('admin_room').emit('live_activity', {
            timestamp: newBet.placedAt,
            game: 'Game 1-20',
            username: user.username,
            amount: newBet.betAmount,
            choice: newBet.betType
        });

        broadcastAdminStats();

        socket.emit('bet_response', { success: true, message: `Cược ${betAmount.toFixed(4)} USDT vào ${betType} thành công.`, newBalance: user.balance });
        io.to(`user_${user.id}`).emit('user_data_update', { balance: user.balance });
    });

    // [MỚI] Lắng nghe cược (cho game BO Thật)
    socket.on('bo_place_bet', async (data) => {
        const user = findUser('id', parseInt(data.user_id));
        const betAmount = parseFloat(data.amount);
        const betType = data.type;
        const symbol = data.symbol || 'BTC';

        bo_round_symbol = (symbol.toUpperCase() + 'USDT');

        if (!user || game_REAL_BO_Status !== 'OPEN') {
            socket.emit('bo_bet_response', { success: false, message: 'Lỗi: Đã đóng cược.' });
            return;
        }
        if (isNaN(betAmount) || betAmount <= 0 || betAmount > user.balance) {
            socket.emit('bo_bet_response', { success: false, message: 'Lỗi: Số tiền cược không hợp lệ hoặc số dư không đủ.' });
            return;
        }
        if (!valid_REAL_BO_BetTypes.includes(betType)) {
            socket.emit('bo_bet_response', { success: false, message: 'Lỗi: Cửa cược không hợp lệ.' });
            return;
        }

        user.balance = parseFloat((user.balance - betAmount).toFixed(4));
        await saveData();

        const newBet = {
            betId: allData.allBets.length + 1,
            userId: user.id, username: user.username,
            betAmount: betAmount, betType: betType,
            placedAt: new Date().toISOString(),
            status: 'PENDING', payout: 0, resultNumber: null
        };
        allData.allBets.push(newBet);

        // [THÊM ĐOẠN NÀY VÀO 5 HÀM]
        if (betAmount >= (global.WHALE_BET_THRESHOLD || 100)) {
            io.to('admin_room').emit('whale_alert', {
                game: 'Game BO',
                username: user.username,
                amount: betAmount
            });
        }

        if (!game_REAL_BO_Bets[user.id]) {
            game_REAL_BO_Bets[user.id] = [];
        }
        game_REAL_BO_Bets[user.id].push(newBet);

        io.to('admin_room').emit('live_activity', {
            timestamp: newBet.placedAt,
            game: 'Game BO',
            username: user.username,
            amount: newBet.betAmount,
            choice: newBet.betType
        });

        broadcastAdminStats();

        socket.emit('bo_bet_response', {
            success: true,
            message: `Cược ${betAmount.toFixed(4)} USDT vào ${betType} thành công.`,
            newBalance: user.balance,
            bet: newBet
        });
        io.to(`user_${user.id}`).emit('user_data_update', { balance: user.balance });
    });

    socket.on('request_user_data', (data) => {
        const user = findUser('id', parseInt(data.user_id));
        if (user) {
            socket.emit('user_data_update', { balance: user.balance });
        }
    });

    // --- Logic cho Game "Nhảy Dù" (Crash) [ĐÃ NÂNG CẤP] ---
    socket.emit('crash_history', crashGameHistory);
    broadcastCrashUpdate();
    socket.on('crash_bet', async (data) => {
        if (!user) return socket.emit('game_error', 'Lỗi: Không tìm thấy người dùng.');
        if (crashGame.state !== 'WAITING') {
            return socket.emit('bet_response', {
                success: false,
                message: 'Chỉ có thể cược khi đang chờ. Vui lòng đợi phiên tiếp theo.',
                panelId: data.panelId?.toString() || '1'
            });
        }

        const panelId = data.panelId.toString();
        if (panelId !== '1' && panelId !== '2') {
            return socket.emit('bet_response', {
                success: false,
                message: 'Panel cược không hợp lệ.',
                panelId: panelId
            });
        }

        if (crashGame.allActivePlayers[user.id] && crashGame.allActivePlayers[user.id][panelId]) {
            return socket.emit('bet_response', {
                success: false,
                message: `Bạn đã cược cho Panel ${panelId} rồi.`,
                panelId: panelId
            });
        }
        const betAmount = parseFloat(data.betAmount);
        const minBetUSDT = 0.1;
        if (isNaN(betAmount) || betAmount < minBetUSDT) {
            return socket.emit('bet_response', {
                success: false,
                message: `Số tiền cược tối thiểu là ${minBetUSDT} USDT.`,
                panelId: panelId
            });
        }
        // Tính tổng số dư đã cược ở các panel khác
        let totalOtherBets = 0;
        if (crashGame.allActivePlayers[user.id]) {
            for (const pid in crashGame.allActivePlayers[user.id]) {
                if (pid !== panelId) {
                    totalOtherBets += crashGame.allActivePlayers[user.id][pid].betAmount || 0;
                }
            }
        }
        // Kiểm tra số dư: tổng cược (panel hiện tại + các panel khác) không được vượt quá số dư
        if (betAmount + totalOtherBets > user.balance + 0.00001) {
            return socket.emit('bet_response', {
                success: false,
                message: 'Số dư không đủ. Tổng cược của bạn vượt quá số dư hiện có.',
                panelId: panelId
            });
        }
        user.balance = parseFloat((user.balance - betAmount).toFixed(4));
        const betInfo = {
            betAmount: betAmount, username: user.username,
            avatar: user.avatar || `https://api.dicebear.com/8.x/bottts/svg?seed=${user.username}`,
            isBot: false, state: 'BET'
        };
        if (!crashGame.allActivePlayers[user.id]) {
            crashGame.allActivePlayers[user.id] = {};
        }
        crashGame.allActivePlayers[user.id][panelId] = betInfo;
        await saveData();

        // [THÊM ĐOẠN NÀY VÀO 5 HÀM]
        if (betAmount >= (global.WHALE_BET_THRESHOLD || 100)) {
            io.to('admin_room').emit('whale_alert', {
                game: 'Game Crash',
                username: user.username,
                amount: betAmount
            });
        }

        io.to('admin_room').emit('live_activity', {
            timestamp: new Date().toISOString(),
            game: 'Game Crash',
            username: user.username,
            amount: betAmount,
            choice: 'Cược'
        });

        broadcastAdminStats();
        socket.emit('bet_response', {
            success: true, message: 'Đặt cược thành công!',
            newBalance: user.balance, betAmount: betAmount, panelId: panelId
        });
        broadcastCrashUpdate();
    });
    socket.on('crash_cancel_bet', async (data) => {
        if (!user) return socket.emit('game_error', 'Lỗi: Không tìm thấy người dùng.');
        if (crashGame.state !== 'WAITING') return socket.emit('game_error', 'Không thể hủy khi game đang chạy.');
        const panelId = data.panelId.toString();
        const bet = crashGame.allActivePlayers[user.id] ? crashGame.allActivePlayers[user.id][panelId] : null;
        if (!bet || bet.isBot) return socket.emit('game_error', 'Bạn chưa đặt cược ở panel này.');
        user.balance = parseFloat((user.balance + bet.betAmount).toFixed(4));
        delete crashGame.allActivePlayers[user.id][panelId];
        if (Object.keys(crashGame.allActivePlayers[user.id]).length === 0) {
            delete crashGame.allActivePlayers[user.id];
        }
        await saveData();
        broadcastAdminStats();
        socket.emit('cancel_bet_response', {
            success: true, message: 'Đã hủy cược.',
            newBalance: user.balance, panelId: panelId
        });
        broadcastCrashUpdate();
    });
    socket.on('crash_cashout', async (data) => {
        if (!user) return socket.emit('game_error', 'Lỗi: Không tìm thấy người dùng.');
        if (crashGame.state !== 'RUNNING') return socket.emit('game_error', 'Game chưa bắt đầu hoặc đã kết thúc.');
        const panelId = data.panelId.toString();
        const bet = crashGame.allActivePlayers[user.id] ? crashGame.allActivePlayers[user.id][panelId] : null;
        if (!bet || bet.isBot || bet.state !== 'RUNNING') {
            return socket.emit('game_error', 'Bạn không có cược đang chạy ở panel này.');
        }
        const winnings = parseFloat((bet.betAmount * crashGame.multiplier).toFixed(4));
        user.balance = parseFloat((user.balance + winnings).toFixed(4));
        const profit = winnings - bet.betAmount;
        gameBank -= profit;
        if (!crashGame.allCashedOutPlayers[user.id]) {
            crashGame.allCashedOutPlayers[user.id] = {};
        }
        crashGame.allCashedOutPlayers[user.id][panelId] = {
            ...bet, cashOutAt: crashGame.multiplier,
            won: winnings, state: 'CASHED_OUT'
        };
        delete crashGame.allActivePlayers[user.id][panelId];
        if (Object.keys(crashGame.allActivePlayers[user.id]).length === 0) {
            delete crashGame.allActivePlayers[user.id];
        }
        logCrashBet(user.id, bet, crashGame.multiplier, 'WIN');
        if (profit > 0) {
            io.emit('new_win_notification', {
                username: user.username, amount: profit, currency: 'USDT'
            });
        }
        await saveData();
        socket.emit('cashout_success', {
            newBalance: user.balance, won: profit,
            multiplier: crashGame.multiplier, panelId: panelId
        });
        broadcastCrashUpdate();
    });
    socket.on('request_crash_update_admin', () => {
        socket.emit('crash_update', {
            state: crashGame.state, countdown: crashGame.countdown,
            multiplier: crashGame.multiplier, playerBets: {},
            allActivePlayers: crashGame.allActivePlayers,
            allCashedOutPlayers: crashGame.allCashedOutPlayers
        });
    });
    setTimeout(broadcastAdminStats, 100);
    socket.on('admin_request_stats', () => {
        socket.emit('admin_stats_update', getAdminStats());
    });

    // [SỬA LỖI V5] Gộp logic disconnect (chỉ cập nhật stats admin)
    socket.on('disconnect', () => {
        // Bot chat sẽ tự động cập nhật số người online
        setTimeout(broadcastAdminStats, 100);
    });
});


// **********************************************
// Chạy Server
// **********************************************

// Telegram webhook setup function
async function setupTelegramWebhook() {
    if (!TELEGRAM_BOT_TOKEN) {
        console.log('⚠️ TELEGRAM_BOT_TOKEN không được cấu hình');
        return;
    }

    try {
        // Xóa webhook cũ nếu có và drop pending updates
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/deleteWebhook`, {
            drop_pending_updates: true
        });
        console.log('✅ Đã xóa webhook cũ');

        // Chờ 2 giây để Telegram clear webhook
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Nếu bạn có domain công khai, hãy uncomment và cập nhật dòng dưới:
        // const webhookUrl = 'https://yourdomain.com/api/telegram/webhook';
        // await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`, {
        //     url: webhookUrl
        // });
        // console.log(`✅ Đã thiết lập webhook: ${webhookUrl}`);

        // Sử dụng long polling thay vì webhook (cho development/local)
        console.log('📱 Telegram bot đang sử dụng chế độ long polling');
        startTelegramPolling();

        // Gửi tin nhắn test
        await sendTelegramMessage('✅ *TELEGRAM BOT ĐÃ SẴN SÀNG*\n\nGửi `/admin` để mở menu quản trị\!');

    } catch (error) {
        console.error('❌ Lỗi thiết lập Telegram webhook:', error.message);
    }
}

// Long polling cho Telegram (thay thế webhook khi chưa có domain công khai)
let lastUpdateId = 0;
let pollingActive = false;
let isProcessingUpdate = false;

async function startTelegramPolling() {
    if (!TELEGRAM_BOT_TOKEN || pollingActive) return;

    pollingActive = true;
    console.log('🔄 Bắt đầu Telegram long polling...');

    const poll = async () => {
        if (!pollingActive) return;

        // Chờ nếu đang xử lý update trước
        if (isProcessingUpdate) {
            setTimeout(poll, 100);
            return;
        }

        try {
            const response = await axios.get(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates`, {
                params: {
                    offset: lastUpdateId + 1,
                    timeout: 20,
                    allowed_updates: ['message', 'callback_query']
                },
                timeout: 25000
            });

            if (response.data.ok && response.data.result.length > 0) {
                isProcessingUpdate = true;

                for (const update of response.data.result) {
                    lastUpdateId = update.update_id;

                    try {
                        // Handle text messages
                        if (update.message && update.message.text) {
                            const chatId = update.message.chat.id;
                            const messageText = update.message.text;

                            if (chatId.toString() === TELEGRAM_CHAT_ID) {
                                console.log(`📨 Nhận lệnh: ${messageText}`);
                                await handleAdminCommand(chatId, messageText);
                            }
                        }

                        // Handle callback queries
                        if (update.callback_query) {
                            const chatId = update.callback_query.message.chat.id;

                            if (chatId.toString() === TELEGRAM_CHAT_ID) {
                                console.log(`🔘 Nhận callback: ${update.callback_query.data}`);
                                await processCallbackQuery(update.callback_query);
                            }
                        }
                    } catch (updateError) {
                        console.error('❌ Lỗi xử lý update:', updateError.message);
                    }
                }

                isProcessingUpdate = false;
            }
        } catch (error) {
            isProcessingUpdate = false;

            if (error.code === 'ECONNABORTED') {
                // Timeout - bình thường, tiếp tục polling
            } else if (error.response?.status === 409) {
                console.log('⚠️ Conflict 409 - chờ 3s...');
                await new Promise(resolve => setTimeout(resolve, 3000));
            } else if (error.response?.status === 400) {
                console.error('❌ Lỗi 400:', error.response?.data?.description || error.message);
            } else {
                console.error('❌ Lỗi polling:', error.message);
            }
        }

        // Tiếp tục polling ngay lập tức
        setImmediate(poll);
    };

    poll();
}

// ============================================================
// [SỬA] HÀM XỬ LÝ NÚT BẤM TELEGRAM (Duyệt Nạp + Chỉnh Cầu)
// ============================================================
async function processCallbackQuery(callback_query) {
    const callbackData = callback_query.data;
    const message = callback_query.message;
    const chatId = callback_query.message.chat.id;
    const callbackQueryId = callback_query.id;

    // Hàm trả lời nhanh để tắt biểu tượng loading trên nút
    const answerCallback = async (text = 'Đang xử lý...', showAlert = false) => {
        try {
            await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                callback_query_id: callbackQueryId,
                text: text,
                show_alert: showAlert
            });
        } catch (e) {
            console.error('Lỗi answerCallback:', e.message);
        }
    };

    try {
        console.log(`🔘 Telegram Action: ${callbackData}`);

        // ---------------------------------------------------------
        // 1. XỬ LÝ DUYỆT / TỪ CHỐI NẠP TIỀN
        // ---------------------------------------------------------
        if (callbackData.startsWith('deposit_approve_')) {
            const depositId = parseInt(callbackData.replace('deposit_approve_', ''));
            const result = await processDepositAction(depositId, 'approve', 'Telegram Admin');

            await answerCallback(result.success ? '✅ Đã duyệt thành công!' : '❌ Lỗi: ' + result.message, true);

            if (result.success) {
                // Sửa tin nhắn cũ thành ĐÃ DUYỆT
                const originalText = message.text.split('\n\n')[0]; // Giữ lại nội dung gốc
                const newText = `✅ *ĐÃ DUYỆT LỆNH NẠP*\n\n${originalText}\n\n_👤 Người duyệt: Admin Telegram_`;

                try {
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
                        chat_id: chatId,
                        message_id: message.message_id,
                        text: newText,
                        parse_mode: 'Markdown' // Bỏ MarkdownV2 cho đỡ lỗi ký tự
                    });
                } catch (e) { console.error('Lỗi editMessageText:', e.message); }
            }
            return;

        } else if (callbackData.startsWith('deposit_reject_')) {
            const depositId = parseInt(callbackData.replace('deposit_reject_', ''));
            const result = await processDepositAction(depositId, 'reject', 'Telegram Admin');

            await answerCallback(result.success ? '✅ Đã từ chối lệnh nạp!' : '❌ Lỗi: ' + result.message, true);

            if (result.success) {
                const originalText = message.text.split('\n\n')[0];
                const newText = `❌ *ĐÃ TỪ CHỐI LỆNH NẠP*\n\n${originalText}\n\n_👤 Người từ chối: Admin Telegram_`;

                try {
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
                        chat_id: chatId,
                        message_id: message.message_id,
                        text: newText,
                        parse_mode: 'Markdown'
                    });
                } catch (e) { console.error('Lỗi editMessageText:', e.message); }
            }
            return;
        }

        // ---------------------------------------------------------
        // 2. MENU ĐIỀU HƯỚNG CHÍNH
        // ---------------------------------------------------------
        await answerCallback('OK'); // Trả lời mặc định cho các menu

        if (callbackData === 'admin_menu') {
            await sendEnhancedAdminMenu(chatId);
        } else if (callbackData === 'game_control') {
            await sendEnhancedGameControlMenu(chatId);
        } else if (callbackData === 'system_stats') {
            await sendSystemStats(chatId);

            // ---------------------------------------------------------
            // 3. MENU CON CỦA TỪNG GAME
            // ---------------------------------------------------------
        } else if (callbackData === 'rig_bo_menu') {
            await sendBORigMenu(chatId);
        } else if (callbackData === 'rig_crash_menu') {
            await sendCrashRigMenu(chatId);
        } else if (callbackData === 'rig_40s_menu') {
            await send40sRigMenu(chatId);
        } else if (callbackData === 'rig_mines_menu') {
            await sendMinesRigMenu(chatId);
        } else if (callbackData === 'rig_hilo_menu') {
            await sendHiloRigMenu(chatId);
        } else if (callbackData === 'auto_modes_menu') {
            await sendAutoModesMenu(chatId);

            // ---------------------------------------------------------
            // 4. XỬ LÝ LỆNH CHỈNH CẦU (GAME RIGGING)
            // ---------------------------------------------------------

            // === GAME BO ===
        } else if (callbackData === 'rig_bo_buy') {
            next_BO_Intervention_Manual = { mode: 'manual', type: 'boResult', value: 'BO_MUA' };
            await sendTelegramMessage(`🟢 Đã đặt BO phiên tiếp: **MUA (GREEN)**`);
        } else if (callbackData === 'rig_bo_sell') {
            next_BO_Intervention_Manual = { mode: 'manual', type: 'boResult', value: 'BO_BAN' };
            await sendTelegramMessage(`🔴 Đã đặt BO phiên tiếp: **BÁN (RED)**`);
        } else if (callbackData.startsWith('set_bo_mode_')) {
            const mode = callbackData.replace('set_bo_mode_', '');
            current_BO_Mode = mode;
            await sendTelegramMessage(`🔄 Đã chuyển chế độ BO sang: **${mode.toUpperCase()}**`);

            // === GAME CRASH ===
        } else if (callbackData === 'crash_force_instant') {
            if (crashGame.state === 'RUNNING') {
                forceCrashNow = true;
                await sendTelegramMessage(`⚡ **ĐÃ KÍCH HOẠT NỔ NGAY!**\nMáy bay sẽ nổ ngay lập tức.`);
            } else {
                await sendTelegramMessage(`⚠️ Không thể nổ. Game đang ở trạng thái: ${crashGame.state}`);
            }
        } else if (callbackData.startsWith('rig_crash_')) {
            const valStr = callbackData.replace('rig_crash_', '');
            let multiplier = 1.0;

            // Xử lý các range (Low, Mid, High)
            if (valStr === 'range_low') multiplier = parseFloat((1.01 + Math.random() * 0.98).toFixed(2));
            else if (valStr === 'range_mid') multiplier = parseFloat((2.0 + Math.random() * 3.0).toFixed(2));
            else if (valStr === 'range_high') multiplier = parseFloat((10.0 + Math.random() * 10.0).toFixed(2));
            else if (valStr === 'range_vhigh') multiplier = parseFloat((30.0 + Math.random() * 20.0).toFixed(2));
            else if (valStr === 'range_ultra') multiplier = parseFloat((50.0 + Math.random() * 150.0).toFixed(2));
            else multiplier = parseFloat(valStr); // Số cụ thể (1.0)

            next_Crash_Intervention = { mode: 'manual', multiplier: multiplier };
            await sendTelegramMessage(`🚀 Đã đặt Crash phiên tiếp: **${multiplier}x**`);

        } else if (callbackData.startsWith('set_crash_mode_')) {
            const mode = callbackData.replace('set_crash_mode_', '');
            crashGame.mode = mode;
            current_CRASH_Mode = mode;
            await sendTelegramMessage(`🔄 Đã chuyển chế độ Crash sang: **${mode.toUpperCase()}**`);

            // === GAME 40S ===
        } else if (callbackData.startsWith('rig_40s_')) {
            const number = parseInt(callbackData.replace('rig_40s_', ''));
            next_40S_Intervention = { mode: 'manual', type: 'setNumber', value: number };
            await sendTelegramMessage(`🎲 Đã đặt Game 40S phiên tiếp về số: **${number}**`);
        } else if (callbackData === 'set_40s_auto') {
            next_40S_Intervention = null;
            await sendTelegramMessage(`🤖 40S đã về chế độ Tự Động.`);
        } else if (callbackData === 'set_40s_anti_majority') {
            next_40S_Intervention = { mode: 'anti-majority' };
            await sendTelegramMessage(`⚖️ 40S đã bật chế độ Bẻ Cầu (Anti-Majority).`);

            // === GAME MINES ===
        } else if (callbackData === 'rig_mines_always_hit') {
            minesRigMode = 'always_hit';
            await sendTelegramMessage(`💣 Mines: Chế độ "Dẫm là nổ" (Khách luôn thua).`);
        } else if (callbackData === 'rig_mines_always_safe') {
            minesRigMode = 'always_safe';
            await sendTelegramMessage(`💎 Mines: Chế độ "Bất tử" (Khách luôn thắng).`);
        } else if (callbackData === 'set_mines_auto') {
            minesRigMode = 'auto';
            await sendTelegramMessage(`🤖 Mines: Chế độ Tự Động.`);

            // === GAME HILO ===
        } else if (callbackData === 'rig_hilo_always_lose') {
            hiloRigMode = 'always_lose';
            await sendTelegramMessage(`📉 Hilo: Chế độ "Luôn Thua".`);
        } else if (callbackData === 'rig_hilo_always_win') {
            hiloRigMode = 'always_win';
            await sendTelegramMessage(`📈 Hilo: Chế độ "Luôn Thắng".`);
        } else if (callbackData === 'set_hilo_auto') {
            hiloRigMode = 'auto';
            await sendTelegramMessage(`🤖 Hilo: Chế độ Tự Động.`);
        }

    } catch (error) {
        console.error('❌ Lỗi xử lý callback:', error);
    }
}

(async () => {
    global.gameBank = gameBank;
    await setupInitialData();
    await updateLiveExchangeRate();
    setInterval(updateLiveExchangeRate, 6 * 60 * 60 * 1000);

    startGame_40S_Timer();
    startGame_REAL_BO_Timer();
    startCrashGameLoop();

    startChatSimulation(); // <-- [ĐẢM BẢO CÓ DÒNG NÀY]

    server.listen(PORT, '0.0.0.0', () => {
        console.log(`Server đang chạy tại http://localhost:${PORT}`);

        // Thiết lập Telegram bot sau khi server đã chạy
        setupTelegramWebhook();
    });
})();