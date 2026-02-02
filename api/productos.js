// api/productos.js - API endpoint para productos

require('dotenv').config({ path: '.env.local' });
const { getProductos } = require('../lib/sheets');

module.exports = async (req, res) => {
  // Configurar CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Manejar preflight
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  // Solo permitir GET
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  
  try {
    console.log('📦 Obteniendo productos...');
    
    const productos = await getProductos();
    
    console.log(`✅ ${productos.length} productos obtenidos`);
    
    res.status(200).json({
      success: true,
      productos: productos,
      total: productos.length,
    });
    
  } catch (error) {
    console.error('❌ Error:', error);
    
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};