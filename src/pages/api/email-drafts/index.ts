import type { APIRoute } from 'astro';

// GET: List pending email drafts
export const GET: APIRoute = async ({ url, locals }) => {
  const status = url.searchParams.get('status') || 'pending';

  // PLACEHOLDER: Fetch from database
  // const drafts = await locals.runtime.env.DB.prepare(
  //   `SELECT * FROM email_drafts WHERE status = ? ORDER BY created_at DESC`
  // ).bind(status).all();

  return new Response(JSON.stringify({
    drafts: []
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
};

// POST: Create new email draft (called by Claude integration)
export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const body = await request.json();
    const { to, toName, subject, body: emailBody, taskId, taskTitle } = body;

    if (!to || !subject || !emailBody) {
      return new Response(JSON.stringify({ error: 'to, subject und body erforderlich' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // PLACEHOLDER: Insert draft into database
    // const result = await locals.runtime.env.DB.prepare(
    //   `INSERT INTO email_drafts (to_email, to_name, subject, body, task_id, task_title, status, created_at)
    //    VALUES (?, ?, ?, ?, ?, ?, 'pending', datetime('now'))`
    // ).bind(to, toName || to, subject, emailBody, taskId || null, taskTitle || null).run();

    // PLACEHOLDER: Notify admin about pending draft
    // Send Telegram/Email notification that a draft needs approval

    console.log('Email draft created:', { to, subject, taskTitle });

    return new Response(JSON.stringify({
      success: true,
      message: 'Email-Entwurf erstellt - wartet auf Genehmigung',
      // draftId: result.meta.last_row_id
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Email draft error:', error);
    return new Response(JSON.stringify({ error: 'Interner Fehler' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
