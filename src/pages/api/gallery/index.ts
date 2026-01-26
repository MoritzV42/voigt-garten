import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ url, locals }) => {
  const category = url.searchParams.get('category');

  // PLACEHOLDER: Fetch from D1 database when configured
  // const query = category
  //   ? `SELECT * FROM gallery_images WHERE category = ? ORDER BY uploaded_at DESC`
  //   : `SELECT * FROM gallery_images ORDER BY uploaded_at DESC`;
  // const items = await locals.runtime.env.DB.prepare(query).bind(category).all();

  // For now, return demo data or empty array
  // In production, this will fetch from D1 + R2 URLs

  return new Response(JSON.stringify({
    items: [
      // Demo items - replace with actual database data
      // {
      //   id: '1',
      //   url: '/images/gallery/example.jpg',
      //   thumbnailUrl: '/images/gallery/thumbs/example.jpg',
      //   name: 'Gartenhaus im Sommer',
      //   description: 'Aufgenommen im Juli 2025',
      //   category: 'haus',
      //   type: 'image',
      //   uploadedAt: '2025-07-15T10:30:00Z',
      // },
    ],
    total: 0,
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
};
