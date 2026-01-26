import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ params, request, locals }) => {
  const { id } = params;

  try {
    const body = await request.json().catch(() => ({}));
    const updatedBody = body.body; // Optional: user may have edited the email

    // PLACEHOLDER: Get draft from database
    // const draft = await locals.runtime.env.DB.prepare(
    //   `SELECT * FROM email_drafts WHERE id = ? AND status = 'pending'`
    // ).bind(id).first();

    // if (!draft) {
    //   return new Response(JSON.stringify({ error: 'Draft nicht gefunden oder bereits verarbeitet' }), {
    //     status: 404,
    //     headers: { 'Content-Type': 'application/json' }
    //   });
    // }

    // PLACEHOLDER: Send email via Resend
    // const { Resend } = await import('resend');
    // const resend = new Resend(locals.runtime.env.RESEND_API_KEY);
    // await resend.emails.send({
    //   from: 'Voigt-Garten <anfrage@garten.infinityspace42.de>',
    //   to: draft.to_email,
    //   subject: draft.subject,
    //   text: updatedBody || draft.body,
    //   replyTo: 'moritz.infinityspace42@gmail.com'
    // });

    // PLACEHOLDER: Update draft status
    // await locals.runtime.env.DB.prepare(
    //   `UPDATE email_drafts SET status = 'approved', approved_at = datetime('now'), final_body = ? WHERE id = ?`
    // ).bind(updatedBody || draft.body, id).run();

    // PLACEHOLDER: Log in service provider history
    // await locals.runtime.env.DB.prepare(
    //   `INSERT INTO provider_contacts (provider_email, contact_type, task_id, contacted_at)
    //    VALUES (?, 'email', ?, datetime('now'))`
    // ).bind(draft.to_email, draft.task_id).run();

    console.log('Email approved and sent:', { draftId: id });

    return new Response(JSON.stringify({
      success: true,
      message: 'Email erfolgreich gesendet'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Email approval error:', error);
    return new Response(JSON.stringify({ error: 'Fehler beim Senden' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
