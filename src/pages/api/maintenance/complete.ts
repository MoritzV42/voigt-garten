import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const body = await request.json();
    const { taskId, completedBy, notes, photoUrl } = body;

    if (!taskId || !completedBy) {
      return new Response(JSON.stringify({ error: 'taskId und completedBy erforderlich' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // PLACEHOLDER: Get task details for credit value
    // const task = await locals.runtime.env.DB.prepare(
    //   `SELECT * FROM maintenance_tasks WHERE id = ?`
    // ).bind(taskId).first();

    // PLACEHOLDER: Update task last_done date
    // await locals.runtime.env.DB.prepare(
    //   `UPDATE maintenance_tasks SET last_done = datetime('now'), status = 'done' WHERE id = ?`
    // ).bind(taskId).run();

    // PLACEHOLDER: Log completion
    // await locals.runtime.env.DB.prepare(
    //   `INSERT INTO maintenance_log (task_id, completed_by, completed_at, notes, photo_url)
    //    VALUES (?, ?, datetime('now'), ?, ?)`
    // ).bind(taskId, completedBy, notes || null, photoUrl || null).run();

    // PLACEHOLDER: Add credit to user if task has credit value
    // if (task.credit_value > 0) {
    //   await locals.runtime.env.DB.prepare(
    //     `INSERT INTO credits (guest_email, amount, reason, created_at)
    //      VALUES (?, ?, ?, datetime('now'))`
    //   ).bind(completedBy, task.credit_value, task.title).run();
    // }

    console.log('Task completed:', { taskId, completedBy });

    return new Response(JSON.stringify({
      success: true,
      message: 'Aufgabe als erledigt markiert',
      // creditAdded: task.credit_value
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Maintenance completion error:', error);
    return new Response(JSON.stringify({ error: 'Interner Fehler' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
