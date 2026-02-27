// api/productos.js - VERSIÓN SEGURA
const { getProductos } = require('../lib/sheets');

// ✅ Tu dominio real de Vercel
const DOMINIOS_PERMITIDOS = [
  'https://tu-tienda.vercel.app',    // ← Cambia por tu URL real
  'https://www.tudominio.com',       // ← Si tienes dominio propio
  'http://localhost:3000'            // ← Solo para desarrollo
];

function configurarCORS(req, res) {
  const origin = req.headers.origin;
  if (DOMINIOS_PERMITIDOS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async (req, res) => {
  configurarCORS(req, res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Método no permitido' });
  }

  try {
    const productos = await getProductos();

    // ✅ No exponer el costo al frontend público
    const productosPublicos = productos.map(({ costo, ...p }) => p);

    return res.status(200).json({
      success: true,
      productos: productosPublicos,
      total: productosPublicos.length,
    });

  } catch (error) {
    // ✅ Error genérico al cliente, detalle solo en logs
    console.error('Error en /api/productos:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Error al cargar los productos'
    });
  }
};