// functions/api/productos.js — Cloudflare Pages Function

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
  } else {
    headers['Access-Control-Allow-Origin'] = '*';
  }
  headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
  headers['Access-Control-Allow-Headers'] = 'Content-Type';
  return headers;
}

function limpiarNumero(valor, porDefecto = 0) {
  if (!valor) return porDefecto;
  let str = valor.toString().trim();
  str = str.replace(/[$€£¥₡%\s]/g, '');

  if (str.includes('.') && str.includes(',')) {
    // Detectar cuál es el último separador (ese es el decimal)
    const ultimoPunto = str.lastIndexOf('.');
    const ultimaComa  = str.lastIndexOf(',');
    if (ultimaComa > ultimoPunto) {
      // Coma es decimal: 1.299,00 (formato panameño/europeo)
      str = str.replace(/\./g, '');
      str = str.replace(',', '.');
    } else {
      // Punto es decimal: 1,299.00 (formato americano)
      str = str.replace(/,/g, '');
    }
  } else if (str.includes(',') && !str.includes('.')) {
    const partes = str.split(',');
    const ultimaParte = partes[partes.length - 1];
    if (ultimaParte.length <= 2) {
      str = str.replace(',', '.'); // decimal: 699,00
    } else {
      str = str.replace(/,/g, ''); // miles: 1,299
    }
  } else if (str.includes('.') && !str.includes(',')) {
    const partes = str.split('.');
    const ultimaParte = partes[partes.length - 1];
    if (ultimaParte.length > 2) {
      str = str.replace(/\./g, ''); // miles: 1.299
    }
  }

  str = str.replace(/[^0-9.]/g, '');
  const numero = parseFloat(str);
  return isNaN(numero) ? porDefecto : numero;
}

const toBase64url = (str) =>
  btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

async function getAccessToken(credentials) {
  const now = Math.floor(Date.now() / 1000);
  const header  = toBase64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = toBase64url(JSON.stringify({
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  }));
  const signingInput = `${header}.${payload}`;

  const pemKey = credentials.private_key
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');

  const binaryStr = atob(pemKey);
  const keyData = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) keyData[i] = binaryStr.charCodeAt(i);

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', keyData.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: { name: 'SHA-256' } },
    false, ['sign']
  );

  const signatureBuffer = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' }, cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  const sigArray = new Uint8Array(signatureBuffer);
  let sigStr = '';
  for (let i = 0; i < sigArray.length; i++) sigStr += String.fromCharCode(sigArray[i]);
  const signature = btoa(sigStr).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  const jwt = `${signingInput}.${signature}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new Error(`Token error: ${JSON.stringify(tokenData)}`);
  return tokenData.access_token;
}

export async function onRequestGet({ request, env }) {
  const corsHeaders = getCORSHeaders(request);
  try {
    const credentials = JSON.parse(env.GOOGLE_CREDENTIALS);
    const token = await getAccessToken(credentials);

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.SHEET_ID}/values/Productos!A2:K100`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    const rows = data.values || [];

    const productos = rows.filter(row => row[0]).map(row => {
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
        destacado:   ['Sí','Si','YES','yes','si','sí'].includes((row[7]||'').trim()),
        itbmsPorc,
        itbmsMonto:  Math.round(precioBase * (itbmsPorc / 100) * 100) / 100,
        precioFinal: Math.round(precioBase * (1 + itbmsPorc / 100) * 100) / 100,
      };
    });

    return new Response(
      JSON.stringify({ success: true, productos, total: productos.length }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error en /api/productos:', error.message, error.stack);
    return new Response(
      JSON.stringify({ success: false, error: 'Error al cargar los productos', detalle: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}

export async function onRequestOptions({ request }) {
  return new Response(null, { status: 200, headers: getCORSHeaders(request) });
}