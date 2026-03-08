// functions/api/productos.js — Cloudflare Pages Function
// Reemplaza: api/productos.js (Vercel)
// Cambios: (req,res) → onRequest({request, env})

import { getProductos } from '../../lib/sheets.js';

const DOMINIOS_PERMITIDOS = [
  'https://techzone-tienda.pages.dev',   // ← tu dominio Cloudflare Pages
  'https://techzone-tienda.vercel.app',  // mantener durante transición
  'http://localhost:3000'
];

function getCORSHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const headers = new Headers();
  if (DOMINIOS_PERMITIDOS.includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
  }
  headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return headers;
}

export async function onRequestGet({ request, env }) {
  const corsHeaders = getCORSHeaders(request);

  try {
    const productos = await getProductos(env);

    // No exponer el costo al frontend público
    const productosPublicos = productos.map(({ costo, ...p }) => p);

    return new Response(
      JSON.stringify({
        success: true,
        productos: productosPublicos,
        total: productosPublicos.length,
      }),
      {
        status: 200,
        headers: {
          ...Object.fromEntries(corsHeaders),
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    console.error('Error en /api/productos:', error.message);
    return new Response(
      JSON.stringify({ success: false, error: 'Error al cargar los productos' }),
      {
        status: 500,
        headers: {
          ...Object.fromEntries(corsHeaders),
          'Content-Type': 'application/json',
        },
      }
    );
  }
}

export async function onRequestOptions({ request }) {
  const corsHeaders = getCORSHeaders(request);
  return new Response(null, {
    status: 200,
    headers: Object.fromEntries(corsHeaders),
  });
}