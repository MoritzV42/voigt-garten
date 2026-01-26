import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ params, locals }) => {
  const { id } = params;

  // PLACEHOLDER: Update draft status to rejected
  // await locals.runtime.env.DB.prepare(
  //   `UPDATE email_drafts SET status = 'rejected', rejected_at = datetime('now') WHERE id = ?`
  // ).bind(id).run();

  console.log('Email draft rejected:', { draftId: id });

  return new Response(JSON.stringify({
    success: true,
    message: 'Email-Entwurf abgelehnt'
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
};
