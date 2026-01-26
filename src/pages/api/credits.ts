import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ url, locals }) => {
  const email = url.searchParams.get('email');

  if (!email) {
    return new Response(JSON.stringify({ error: 'Email erforderlich' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // PLACEHOLDER: Fetch credits from database
  // const credits = await locals.runtime.env.DB.prepare(
  //   `SELECT id, amount, reason, created_at, type FROM credits WHERE guest_email = ? ORDER BY created_at DESC LIMIT 20`
  // ).bind(email).all();

  // const totalCredits = await locals.runtime.env.DB.prepare(
  //   `SELECT SUM(amount) as total FROM credits WHERE guest_email = ?`
  // ).bind(email).first();

  // Demo data
  return new Response(JSON.stringify({
    credits: [
      { id: '1', date: '2026-01-15', amount: 15, reason: 'Rasenmähen', type: 'earned' },
      { id: '2', date: '2026-01-10', amount: 20, reason: 'Unkraut jäten', type: 'earned' },
    ],
    total: 35
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
};

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const body = await request.json();
    const { email, amount, reason, type } = body;

    if (!email || amount === undefined || !reason) {
      return new Response(JSON.stringify({ error: 'email, amount und reason erforderlich' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // PLACEHOLDER: Insert credit into database
    // await locals.runtime.env.DB.prepare(
    //   `INSERT INTO credits (guest_email, amount, reason, type, created_at)
    //    VALUES (?, ?, ?, ?, datetime('now'))`
    // ).bind(email, amount, reason, type || 'earned').run();

    console.log('Credit added:', { email, amount, reason });

    return new Response(JSON.stringify({
      success: true,
      message: 'Guthaben hinzugefügt'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Credit error:', error);
    return new Response(JSON.stringify({ error: 'Interner Fehler' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
