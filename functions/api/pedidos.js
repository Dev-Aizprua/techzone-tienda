// functions/api/pedidos.js — Cloudflare Pages Function

const DOMINIOS_PERMITIDOS = [
  'https://techzone-tienda.pages.dev',
  'https://techzone-tienda.vercel.app',
  'http://localhost:3000'
];

const rateLimitMap = new Map();
const LIMITE_PEDIDOS = 5;
const VENTANA_TIEMPO = 60 * 60 * 1000;

function verificarRateLimit(ip) {
  const ahora = Date.now();
  const registro = rateLimitMap.get(ip);
  if (!registro || ahora - registro.inicio > VENTANA_TIEMPO) {
    rateLimitMap.set(ip, { count: 1, inicio: ahora });
    return true;
  }
  if (registro.count >= LIMITE_PEDIDOS) return false;
  registro.count++;
  return true;
}

function validarCliente(cliente) {
  const errores = [];
  if (!cliente) return ['Datos del cliente requeridos'];
  const nombre = (cliente.nombre   || '').trim();
  const email  = (cliente.email    || '').trim();
  const tel    = (cliente.telefono  || '').trim();
  const dir    = (cliente.direccion || '').trim();
  if (!nombre || nombre.length < 2)  errores.push('Nombre requerido');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errores.push('Email no válido');
  if (!tel || tel.length < 7)        errores.push('Teléfono requerido');
  if (!dir || dir.length < 10)       errores.push('Dirección requerida');
  return errores;
}

function validarProductosPedido(productos) {
  if (!productos || !Array.isArray(productos) || productos.length === 0) return ['El carrito está vacío'];
  if (productos.length > 20) return ['Demasiados productos en el pedido'];
  const errores = [];
  productos.forEach((item, i) => {
    if (!item.id) errores.push(`Producto ${i+1}: ID requerido`);
    if (!item.cantidad || item.cantidad < 1 || item.cantidad > 99) errores.push(`Producto ${i+1}: Cantidad inválida`);
  });
  return errores;
}

function getCORSHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const headers = {};
  if (DOMINIOS_PERMITIDOS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  } else {
    headers['Access-Control-Allow-Origin'] = '*';
  }
  headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
  headers['Access-Control-Allow-Headers'] = 'Content-Type';
  return headers;
}

function jsonResponse(data, status, corsHeaders) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

function limpiarNumero(valor, porDefecto = 0) {
  if (!valor) return porDefecto;
  const str = valor.toString().trim().replace(/[$€£¥₡%,\s]/g, '').replace(/[^0-9.]/g, '');
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

async function sheetsGet(token, sheetId, range) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  return data.values || [];
}

async function sheetsAppend(token, sheetId, range, values) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW`;
  await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values })
  });
}

async function sheetsUpdate(token, sheetId, range, value) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
  await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [[value]] })
  });
}

export async function onRequestPost({ request, env }) {
  const corsHeaders = getCORSHeaders(request);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

  if (!verificarRateLimit(ip)) {
    return jsonResponse({ success: false, error: 'Demasiados pedidos. Intenta más tarde.' }, 429, corsHeaders);
  }

  try {
    const body = await request.json();
    const { cliente, productos } = body;

    const erroresCliente = validarCliente(cliente);
    if (erroresCliente.length > 0) return jsonResponse({ success: false, error: erroresCliente.join(', ') }, 400, corsHeaders);

    const erroresProductos = validarProductosPedido(productos);
    if (erroresProductos.length > 0) return jsonResponse({ success: false, error: erroresProductos.join(', ') }, 400, corsHeaders);

    const credentials = JSON.parse(env.GOOGLE_CREDENTIALS);
    const token = await getAccessToken(credentials);
    const SHEET_ID = env.SHEET_ID;

    const rows = await sheetsGet(token, SHEET_ID, 'Productos!A2:K100');
    const productosActuales = rows.filter(row => row[0]).map(row => ({
      id: row[0], nombre: row[1], stock: parseInt(row[6]) || 0
    }));

    let mensajeError = '';
    for (const itemPedido of productos) {
      const prod = productosActuales.find(p => p.id === itemPedido.id);
      if (!prod) mensajeError += `Producto no encontrado. `;
      else if (prod.stock < itemPedido.cantidad) {
        mensajeError += prod.stock === 0
          ? `${itemPedido.nombre} está AGOTADO. `
          : `${itemPedido.nombre} solo tiene ${prod.stock} disponible(s). `;
      }
    }
    if (mensajeError) return jsonResponse({ success: false, error: mensajeError.trim() }, 400, corsHeaders);

    const idPedido = 'TZ-' + Date.now();
    const ahora = new Date();
    const panamaOffset = -5 * 60;
    const panamaTime = new Date(ahora.getTime() + (ahora.getTimezoneOffset() + panamaOffset) * 60000);
    const fecha = `${String(panamaTime.getMonth()+1).padStart(2,'0')}/${String(panamaTime.getDate()).padStart(2,'0')}/${panamaTime.getFullYear()}`;

    let subtotal = 0, totalITBMS = 0;
    productos.forEach(item => {
      subtotal   += (item.precioBase  || 0) * item.cantidad;
      totalITBMS += (item.itbmsMonto || 0) * item.cantidad;
    });
    const total = subtotal + totalITBMS;

    await sheetsAppend(token, SHEET_ID, 'Pedidos!A:J', [[
      fecha, idPedido,
      cliente.nombre.trim(), cliente.email.trim(),
      cliente.telefono.trim(), cliente.direccion.trim(),
      subtotal, totalITBMS, total, 'Pendiente'
    ]]);

    await sheetsAppend(token, SHEET_ID, 'DetallePedidos!A:I',
      productos.map(item => [
        idPedido, item.id, item.nombre, item.cantidad,
        item.precioBase, item.itbmsPorc, item.itbmsMonto,
        item.precioFinal, (item.precioBase || 0) * item.cantidad
      ])
    );

    for (const itemPedido of productos) {
      const filaIndex = productosActuales.findIndex(p => p.id === itemPedido.id) + 2;
      const prod = productosActuales.find(p => p.id === itemPedido.id);
      await sheetsUpdate(token, SHEET_ID, `Productos!G${filaIndex}`, prod.stock - itemPedido.cantidad);
    }

    return jsonResponse({
      success: true,
      pedido: { id: idPedido, fecha, total, subtotal, itbms: totalITBMS, estado: 'Pendiente' }
    }, 200, corsHeaders);

  } catch (error) {
    console.error('Error en pedidos:', error.message, error.stack);
    return jsonResponse({ success: false, error: 'Error al procesar el pedido. Intenta de nuevo.' }, 500, corsHeaders);
  }
}

export async function onRequestOptions({ request }) {
  return new Response(null, { status: 200, headers: getCORSHeaders(request) });
}