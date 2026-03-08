// functions/api/productos.js — Cloudflare Pages Function
// Usa fetch nativo en lugar de googleapis (más liviano)

const DOMINIOS_PERMITIDOS = [
  'https://techzone-tienda.pages.dev',
  'https://techzone-tienda.vercel.app',
  'http://localhost:3000'
];

function getCORSHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const headers = {};
  if (DOMINIOS_PERMITIDOS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
  headers['Access-Control-Allow-Headers'] = 'Content-Type';
  return headers;
}

function limpiarNumero(valor, porDefecto = 0) {
  if (!valor) return porDefecto;
  const str = valor.toString().trim()
    .replace(/[$€£¥₡%,\s]/g, '')
    .replace(/[^0-9.]/g, '');
  const numero = parseFloat(str);
  return isNaN(numero) ? porDefecto : numero;
}

async function getAccessToken(credentials) {
  const now = Math.floor(Date.now() / 1000);
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = btoa(JSON.stringify({
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  }));

  const data = `${header}.${payload}`;
  
  // Importar clave privada
  const pemKey = credentials.private_key
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\n/g, '');
  
  const keyData = Uint8Array.from(atob(pemKey), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', keyData.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );

  const encoder = new TextEncoder();
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', cryptoKey, encoder.encode(data)
  );
  
  const sig = btoa(String.fromCharCode(...new Uint8Array(signature)));
  const jwt = `${data}.${sig}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });

  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}

export async function onRequestGet({ request, env }) {
  const corsHeaders = getCORSHeaders(request);

  try {
    const credentials = JSON.parse(env.GOOGLE_CREDENTIALS);
    const token = await getAccessToken(credentials);

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.SHEET_ID}/values/Productos!A2:K100`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });

    const data = await res.json();
    const rows = data.values || [];

    const productos = rows
      .filter(row => row[0])
      .map(row => {
        const precioBase = limpiarNumero(row[3], 0);
        const itbmsPorc  = limpiarNumero(row[8], 7);
        return {
          id:          row[0] || '',
          nombre:      row[1] || '',
          descripcion: row[2] || '',
          precioBase,
          categoria:   row[4] || '',
          imagen:      row[5] || '',
          stock:       parseInt(row[6]) || 0,
          destacado:   ['Sí','Si','YES'].includes(row[7]),
          itbmsPorc,
          itbmsMonto:  precioBase * (itbmsPorc / 100),
          precioFinal: precioBase * (1 + itbmsPorc / 100),
        };
      });

    return new Response(
      JSON.stringify({ success: true, productos, total: productos.length }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error en /api/productos:', error.message);
    return new Response(
      JSON.stringify({ success: false, error: 'Error al cargar los productos' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}

export async function onRequestOptions({ request }) {
  return new Response(null, { status: 200, headers: getCORSHeaders(request) });
}