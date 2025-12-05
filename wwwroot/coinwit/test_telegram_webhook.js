// Script test webhook Telegram local
const axios = require('axios');

// Test webhook với dữ liệu giả lập từ Telegram
const testWebhook = async () => {
    const testData = {
        update_id: 123456789,
        callback_query: {
            id: 'test_callback_123',
            from: {
                id: 5996989980, // Chat ID của bạn
                is_bot: false,
                first_name: 'Test',
                username: 'testuser'
            },
            message: {
                message_id: 123,
                from: {
                    id: 8242385152,
                    is_bot: true,
                    first_name: 'CoinWit Bot',
                    username: 'coinwit_bot'
                },
                chat: {
                    id: 5996989980, // Chat ID của bạn
                    first_name: 'Test',
                    username: 'testuser',
                    type: 'private'
                },
                date: Math.floor(Date.now() / 1000),
                text: '*LỆNH NẠP MỚI*\nUser: testuser (ID: 1)\nSố tiền: 100,000 VND\nKênh: V8pay - QR Bank\nNội dung: CW1231'
            },
            data: 'deposit_approve_123' // Thay 123 bằng deposit ID thật
        }
    };

    try {
        console.log('🧪 Đang test webhook local...');
        const response = await axios.post('http://localhost:3000/api/telegram/webhook', testData, {
            headers: {
                'Content-Type': 'application/json'
            }
        });
        console.log('✅ Response:', response.data);
    } catch (error) {
        console.error('❌ Lỗi:', error.response?.data || error.message);
    }
};

testWebhook();

