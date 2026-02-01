const { google } = require('googleapis');
const fs = require('fs');

const credentials = JSON.parse(fs.readFileSync('credentials.json', 'utf8'));
const auth = new google.auth.GoogleAuth({
  credentials: credentials,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });
const SHEET_ID = '1JbcsekjdeU1o91ByS9OaT0xdiBsH1A-c-C6tNmO4Rk8';

async function testConnection() {
  try {
    console.log('🔄 Probando conexión con Google Sheets...');
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Productos!A2:D5', 
    });
    const rows = response.data.values || [];
    console.log('✅ ¡Conexión exitosa!');
    console.log(`📦 Productos encontrados: ${rows.length}`);
    if (rows.length > 0) {
      console.log('📋 Primer producto en la lista:', rows[0][1]);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}
testConnection();