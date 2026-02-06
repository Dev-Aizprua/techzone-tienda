// api/pedidos.js - API para procesar pedidos
// Usa las hojas "Pedidos" y "DetallePedidos" existentes
// VERSIÓN COMPLETA con columnas para Dashboard

const { getProductos, SHEET_ID } = require('../lib/sheets');
const { google } = require('googleapis');

// Configurar autenticación
function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  return new google.auth.GoogleAuth({
    credentials: credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

// Obtener cliente de Sheets
function getSheetsClient() {
  const auth = getAuth();
  return google.sheets({ version: 'v4', auth });
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método no permitido' });
  }

  try {
    const { cliente, productos } = req.body;

    console.log('📦 Procesando pedido...');
    console.log('Cliente:', cliente.nombre);
    console.log('Productos:', productos.length);

    // 1. Obtener productos actuales para verificar stock
    const productosActuales = await getProductos();
    
    // 2. Validar stock
    let stockValido = true;
    let mensajeError = '';
    
    for (const itemPedido of productos) {
      const productoActual = productosActuales.find(p => p.id === itemPedido.id);
      
      if (!productoActual) {
        stockValido = false;
        mensajeError += `Producto ${itemPedido.nombre} no encontrado. `;
      } else if (productoActual.stock < itemPedido.cantidad) {
        stockValido = false;
        if (productoActual.stock === 0) {
          mensajeError += `${itemPedido.nombre} está AGOTADO. `;
        } else {
          mensajeError += `${itemPedido.nombre} solo tiene ${productoActual.stock} disponible(s). `;
        }
      }
    }

    if (!stockValido) {
      console.log('❌ Stock insuficiente:', mensajeError);
      return res.status(400).json({
        success: false,
        error: mensajeError.trim()
      });
    }

    const sheets = getSheetsClient();
    const idPedido = 'TZ-' + Date.now();
    const fecha = new Date().toLocaleString('es-PA', { 
      year: 'numeric', 
      month: '2-digit', 
      day: '2-digit', 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit' 
    });
    
    // 3. Calcular totales
    let subtotal = 0;
    let totalITBMS = 0;
    
    productos.forEach(item => {
      subtotal += item.precioBase * item.cantidad;
      totalITBMS += item.itbmsMonto * item.cantidad;
    });
    
    const total = subtotal + totalITBMS;

    // 4. Guardar en hoja "Pedidos"
    // Estructura COMPLETA: A-J
    // A: Fecha
    // B: ID Pedido
    // C: Cliente
    // D: Email
    // E: Teléfono
    // F: Dirección
    // G: Subtotal
    // H: ITBMS
    // I: Total
    // J: Estado (nuevo)
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'Pedidos!A:J',
      valueInputOption: 'RAW',
      requestBody: {
        values: [[
          fecha,
          idPedido,
          cliente.nombre,
          cliente.email,
          cliente.telefono,
          cliente.direccion,
          subtotal,
          totalITBMS,
          total,
          'Pendiente'  // ← NUEVO: Estado por defecto
        ]]
      }
    });
    
    console.log('✅ Pedido guardado en hoja Pedidos (con Estado: Pendiente)');

    // 5. Guardar detalles en hoja "DetallePedidos"
    // Estructura COMPLETA: A-I
    // A: ID Pedido
    // B: ID Producto
    // C: Nombre Producto
    // D: Cantidad
    // E: Precio Base
    // F: ITBMS %
    // G: ITBMS Monto
    // H: Precio Final
    // I: Subtotal (nuevo)
    const detalles = productos.map(item => {
      const subtotalItem = item.precioBase * item.cantidad; // ← Subtotal del item
      
      return [
        idPedido,
        item.id,
        item.nombre,
        item.cantidad,
        item.precioBase,
        item.itbmsPorc,
        item.itbmsMonto,
        item.precioFinal,
        subtotalItem  // ← NUEVO: Subtotal = precioBase × cantidad
      ];
    });

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'DetallePedidos!A:I',
      valueInputOption: 'RAW',
      requestBody: {
        values: detalles
      }
    });
    
    console.log('✅ Detalles guardados en hoja DetallePedidos (con Subtotal por item)');

    // 6. Reducir stock en hoja "Productos"
    for (const itemPedido of productos) {
      const productoActual = productosActuales.find(p => p.id === itemPedido.id);
      const nuevoStock = productoActual.stock - itemPedido.cantidad;
      
      // Encontrar la fila del producto (asumiendo que están en orden desde la fila 2)
      const filaIndex = productosActuales.findIndex(p => p.id === itemPedido.id) + 2; // +2 porque empieza en A2
      
      // Actualizar stock (columna G)
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `Productos!G${filaIndex}`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [[nuevoStock]]
        }
      });
      
      console.log(`✅ Stock actualizado: ${itemPedido.nombre} - Stock anterior: ${productoActual.stock} → Nuevo: ${nuevoStock}`);
    }

    console.log('✅ Pedido procesado exitosamente:', idPedido);
    console.log('📊 Resumen:');
    console.log('   - Subtotal:', subtotal);
    console.log('   - ITBMS:', totalITBMS);
    console.log('   - Total:', total);
    console.log('   - Estado: Pendiente');

    // 7. Retornar éxito
    return res.status(200).json({
      success: true,
      pedido: {
        id: idPedido,
        fecha: fecha,
        total: total,
        subtotal: subtotal,
        itbms: totalITBMS,
        estado: 'Pendiente'
      }
    });

  } catch (error) {
    console.error('❌ Error al procesar pedido:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al procesar el pedido: ' + error.message
    });
  }
};