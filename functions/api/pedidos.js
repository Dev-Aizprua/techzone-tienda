// functions/api/pedidos.js — Cloudflare Pages Function
// Reemplaza: api/pedidos.js (Vercel)
// Cambios clave:
//   - (req,res) → onRequestPost({request, env})
//   - res.status(x).json() → new Response(JSON.stringify(), {status:x})
//   - req.headers['x-forwarded-for'] → request.headers.get('CF-Connecting-IP')
//   - req.body → await request.json()

import { getProductos } from '../../lib/sheets.js';
import { GoogleAuth } from 'google-auth-library';
import { google } from 'googleapis';

const DOMINIOS_PERMITIDOS = [
  'https://techzone-tienda.pages.dev',   // ← tu dominio Cloudflare Pages
  'https://techzone-tienda.vercel.app',  // mantener durante transición
  'http://localhost:3000'
];

// ─── Rate Limiting (en memoria, se resetea por instancia) ───────────────────
const rateLimitMap = new Map();
const LIMITE_PEDIDOS = 5;
const VENTANA_TIEMPO = 60 * 60 * 1000;

function verificarRateLimit(ip) {
  const ahora    = Date.now();
  const registro = rateLimitMap.get(ip);
  if (!registro || ahora - registro.inicio > VENTANA_TIEMPO) {
    rateLimitMap.set(ip, { count: 1, inicio: ahora });
    return true;
  }
  if (registro.count >= LIMITE_PEDIDOS) return false;
  registro.count++;
  return true;
}

// ─── Validaciones ───────────────────────────────────────────────────────────
function validarCliente(cliente) {
  const errores = [];
  if (!cliente) return ['Datos del cliente requeridos'];

  const nombre = (cliente.nombre    || '').trim();
  const email  = (cliente.email     || '').trim();
  const tel    = (cliente.telefono  || '').trim();
  const dir    = (cliente.direccion || '').trim();

  if (!nombre || nombre.length < 2)  errores.push('Nombre requerido');
  if (nombre.length > 100)           errores.push('Nombre demasiado largo');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
                                     errores.push('Email no válido');
  if (!tel || tel.length < 7)        errores.push('Teléfono requerido');
  if (!dir || dir.length < 10)       errores.push('Dirección requerida');

  return errores;
}

function validarProductosPedido(productos) {
  if (!productos || !Array.isArray(productos) || productos.length === 0)
    return ['El carrito está vacío'];
  if (productos.length > 20)
    return ['Demasiados productos en el pedido'];

  const errores = [];
  productos.forEach((item, i) => {
    if (!item.id)                                          errores.push(`Producto ${i+1}: ID requerido`);
    if (!item.cantidad || item.cantidad < 1 || item.cantidad > 99) errores.push(`Producto ${i+1}: Cantidad inválida`);
    if (item.precioBase < 0)                               errores.push(`Producto ${i+1}: Precio inválido`);
  });
  return errores;
}

// ─── CORS ───────────────────────────────────────────────────────────────────
function getCORSHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const headers = {};
  if (DOMINIOS_PERMITIDOS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
  headers['Access-Control-Allow-Headers'] = 'Content-Type';
  return headers;
}

function jsonResponse(data, status, corsHeaders) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ─── Google Sheets Auth (usando env de Cloudflare) ──────────────────────────
function getSheetsClient(env) {
  const credentials = JSON.parse(env.GOOGLE_CREDENTIALS);
  const auth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

// ─── Handler principal ───────────────────────────────────────────────────────
export async function onRequestPost({ request, env }) {
  const corsHeaders = getCORSHeaders(request);

  // IP desde Cloudflare (más confiable que x-forwarded-for)
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!verificarRateLimit(ip)) {
    return jsonResponse(
      { success: false, error: 'Demasiados pedidos. Intenta más tarde.' },
      429, corsHeaders
    );
  }

  try {
    const body = await request.json();
    const { cliente, productos } = body;

    const erroresCliente = validarCliente(cliente);
    if (erroresCliente.length > 0) {
      return jsonResponse({ success: false, error: erroresCliente.join(', ') }, 400, corsHeaders);
    }

    const erroresProductos = validarProductosPedido(productos);
    if (erroresProductos.length > 0) {
      return jsonResponse({ success: false, error: erroresProductos.join(', ') }, 400, corsHeaders);
    }

    // Verificar stock actual
    const productosActuales = await getProductos(env);
    let mensajeError = '';

    for (const itemPedido of productos) {
      const productoActual = productosActuales.find(p => p.id === itemPedido.id);
      if (!productoActual) {
        mensajeError += `Producto no encontrado. `;
      } else if (productoActual.stock < itemPedido.cantidad) {
        mensajeError += productoActual.stock === 0
          ? `${itemPedido.nombre} está AGOTADO. `
          : `${itemPedido.nombre} solo tiene ${productoActual.stock} disponible(s). `;
      }
    }

    if (mensajeError) {
      return jsonResponse({ success: false, error: mensajeError.trim() }, 400, corsHeaders);
    }

    const sheets   = getSheetsClient(env);
    const SHEET_ID = env.SHEET_ID;
    const idPedido = 'TZ-' + Date.now();

    // Fecha en zona horaria Panamá UTC-5
    const ahora      = new Date();
    const panamaTime = new Date(ahora.getTime() + (ahora.getTimezoneOffset() - 300) * 60000);
    const fecha      = `${String(panamaTime.getMonth()+1).padStart(2,'0')}/${String(panamaTime.getDate()).padStart(2,'0')}/${panamaTime.getFullYear()}`;

    let subtotal = 0, totalITBMS = 0;
    productos.forEach(item => {
      subtotal   += item.precioBase  * item.cantidad;
      totalITBMS += item.itbmsMonto * item.cantidad;
    });
    const total = subtotal + totalITBMS;

    // Guardar pedido
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'Pedidos!A:J',
      valueInputOption: 'RAW',
      requestBody: {
        values: [[
          fecha, idPedido,
          cliente.nombre.trim(), cliente.email.trim(),
          cliente.telefono.trim(), cliente.direccion.trim(),
          subtotal, totalITBMS, total, 'Pendiente'
        ]]
      }
    });

    // Guardar detalle de pedido
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'DetallePedidos!A:I',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: productos.map(item => [
          idPedido, item.id, item.nombre, item.cantidad,
          item.precioBase, item.itbmsPorc, item.itbmsMonto,
          item.precioFinal, item.precioBase * item.cantidad
        ])
      }
    });

    // Reducir stock en Google Sheets
    for (const itemPedido of productos) {
      const productoActual = productosActuales.find(p => p.id === itemPedido.id);
      const filaIndex      = productosActuales.findIndex(p => p.id === itemPedido.id) + 2;
      const nuevoStock     = productoActual.stock - itemPedido.cantidad;

      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `Productos!G${filaIndex}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[nuevoStock]] }
      });
    }

    console.log(`Pedido ${idPedido} - Total: $${total.toFixed(2)}`);

    return jsonResponse({
      success: true,
      pedido: {
        id:      idPedido,
        fecha,
        total,
        subtotal,
        itbms:   totalITBMS,
        estado:  'Pendiente'
      }
    }, 200, corsHeaders);

  } catch (error) {
    console.error('Error en pedidos:', error.message);
    return jsonResponse(
      { success: false, error: 'Error al procesar el pedido. Intenta de nuevo.' },
      500, corsHeaders
    );
  }
}

export async function onRequestOptions({ request }) {
  return new Response(null, {
    status: 200,
    headers: getCORSHeaders(request),
  });
}