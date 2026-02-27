javascript// api/pedidos.js - VERSIÓN SEGURA
const { getProductos, SHEET_ID } = require('../lib/sheets');
const { google } = require('googleapis');

const DOMINIOS_PERMITIDOS = [
  'https://techzone-tienda.vercel.app',
  'http://localhost:3000'
];
// ✅ Rate limiting simple en memoria
const rateLimitMap = new Map();
const LIMITE_PEDIDOS  = 5;   // máximo 5 pedidos
const VENTANA_TIEMPO  = 60 * 60 * 1000; // por hora

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

// ✅ Validación completa del cliente
function validarCliente(cliente) {
  const errores = [];

  if (!cliente) {
    return ['Datos del cliente requeridos'];
  }

  const nombre = (cliente.nombre || '').trim();
  const email  = (cliente.email  || '').trim();
  const tel    = (cliente.telefono  || '').trim();
  const dir    = (cliente.direccion || '').trim();

  if (!nombre || nombre.length < 2)
    errores.push('Nombre requerido (mínimo 2 caracteres)');
  if (nombre.length > 100)
    errores.push('Nombre demasiado largo');

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email))
    errores.push('Email no válido');

  if (!tel || tel.length < 7)
    errores.push('Teléfono requerido');

  if (!dir || dir.length < 10)
    errores.push('Dirección requerida (mínimo 10 caracteres)');

  return errores;
}

// ✅ Validación de productos del pedido
function validarProductosPedido(productos) {
  const errores = [];

  if (!productos || !Array.isArray(productos) || productos.length === 0) {
    return ['El carrito está vacío'];
  }

  if (productos.length > 20) {
    return ['Demasiados productos en el pedido'];
  }

  productos.forEach((item, i) => {
    if (!item.id)
      errores.push(`Producto ${i+1}: ID requerido`);
    if (!item.cantidad || item.cantidad < 1 || item.cantidad > 99)
      errores.push(`Producto ${i+1}: Cantidad inválida`);
    if (item.precioBase < 0)
      errores.push(`Producto ${i+1}: Precio inválido`);
  });

  return errores;
}

function configurarCORS(req, res) {
  const origin = req.headers.origin;
  if (DOMINIOS_PERMITIDOS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

function getSheetsClient() {
  return google.sheets({ version: 'v4', auth: getAuth() });
}

module.exports = async (req, res) => {
  configurarCORS(req, res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método no permitido' });
  }

  // ✅ Verificar rate limit por IP
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  if (!verificarRateLimit(ip)) {
    return res.status(429).json({
      success: false,
      error: 'Demasiados pedidos. Intenta más tarde.'
    });
  }

  try {
    const { cliente, productos } = req.body;

    // ✅ Validar cliente
    const erroresCliente = validarCliente(cliente);
    if (erroresCliente.length > 0) {
      return res.status(400).json({
        success: false,
        error: erroresCliente.join(', ')
      });
    }

    // ✅ Validar productos
    const erroresProductos = validarProductosPedido(productos);
    if (erroresProductos.length > 0) {
      return res.status(400).json({
        success: false,
        error: erroresProductos.join(', ')
      });
    }

    // Verificar stock
    const productosActuales = await getProductos();
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
      return res.status(400).json({ success: false, error: mensajeError.trim() });
    }

    const sheets   = getSheetsClient();
    const idPedido = 'TZ-' + Date.now();

    // Fecha en zona horaria Panamá
    const ahora       = new Date();
    const panamaTime  = new Date(ahora.getTime() + (ahora.getTimezoneOffset() - 300) * 60000);
    const fecha       = `${String(panamaTime.getMonth()+1).padStart(2,'0')}/${String(panamaTime.getDate()).padStart(2,'0')}/${panamaTime.getFullYear()}`;

    // Calcular totales
    let subtotal = 0, totalITBMS = 0;
    productos.forEach(item => {
      subtotal    += item.precioBase * item.cantidad;
      totalITBMS  += item.itbmsMonto * item.cantidad;
    });
    const total = subtotal + totalITBMS;

    // Guardar pedido
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'Pedidos!A:J',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          fecha, idPedido,
          cliente.nombre.trim(), cliente.email.trim(),
          cliente.telefono.trim(), cliente.direccion.trim(),
          subtotal, totalITBMS, total, 'Pendiente'
        ]]
      }
    });

    // Guardar detalle
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

    // Reducir stock
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

    // ✅ Log sin datos sensibles
    console.log(`✅ Pedido ${idPedido} procesado - Total: $${total.toFixed(2)}`);

    return res.status(200).json({
      success: true,
      pedido: { id: idPedido, fecha, total, subtotal, itbms: totalITBMS, estado: 'Pendiente' }
    });

  } catch (error) {
    // ✅ Error genérico al cliente
    console.error('Error en /api/pedidos:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Error al procesar el pedido. Intenta de nuevo.'
    });
  }
};