import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const body = await request.json();

    // Validate required fields
    const { name, email, checkIn, checkOut, guests, totalPrice, discountCode, notes, pets } = body;

    if (!name || !email || !checkIn || !checkOut) {
      return new Response(JSON.stringify({ error: 'Fehlende Pflichtfelder' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // PLACEHOLDER: Validate dates don't overlap with existing bookings
    // const existingBookings = await locals.runtime.env.DB.prepare(
    //   `SELECT * FROM bookings WHERE
    //    (check_in <= ? AND check_out >= ?) OR
    //    (check_in <= ? AND check_out >= ?)`
    // ).bind(checkOut, checkIn, checkIn, checkIn).all();

    // PLACEHOLDER: Insert booking into database
    // const result = await locals.runtime.env.DB.prepare(
    //   `INSERT INTO bookings (guest_name, guest_email, check_in, check_out, guests, total_price, discount_code, notes, has_pets, status, created_at)
    //    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'))`
    // ).bind(name, email, checkIn, checkOut, guests, totalPrice, discountCode || null, notes || null, pets ? 1 : 0).run();

    // PLACEHOLDER: Send confirmation email via Resend
    // const { Resend } = await import('resend');
    // const resend = new Resend(locals.runtime.env.RESEND_API_KEY);
    // await resend.emails.send({
    //   from: 'Voigt-Garten <buchung@garten.infinityspace42.de>',
    //   to: email,
    //   subject: 'Buchungsanfrage eingegangen',
    //   html: `<h1>Hallo ${name}!</h1><p>Deine Buchung für ${checkIn} bis ${checkOut} ist eingegangen...</p>`
    // });

    // PLACEHOLDER: Notify admin
    // await resend.emails.send({
    //   from: 'Voigt-Garten <system@garten.infinityspace42.de>',
    //   to: 'moritz.infinityspace42@gmail.com',
    //   subject: `Neue Buchungsanfrage: ${name}`,
    //   html: `<p>Neue Buchung von ${name} (${email})</p><p>${checkIn} - ${checkOut}</p><p>Preis: ${totalPrice}€</p>`
    // });

    console.log('Buchungsanfrage erhalten:', { name, email, checkIn, checkOut, totalPrice });

    return new Response(JSON.stringify({
      success: true,
      message: 'Buchungsanfrage erfolgreich',
      // bookingId: result.meta.last_row_id
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Booking error:', error);
    return new Response(JSON.stringify({ error: 'Interner Fehler' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const GET: APIRoute = async ({ url, locals }) => {
  // Get bookings (for calendar)
  const startDate = url.searchParams.get('start');
  const endDate = url.searchParams.get('end');

  // PLACEHOLDER: Fetch from database
  // const bookings = await locals.runtime.env.DB.prepare(
  //   `SELECT check_in, check_out FROM bookings
  //    WHERE status IN ('confirmed', 'pending')
  //    AND check_out >= ? AND check_in <= ?`
  // ).bind(startDate, endDate).all();

  // Return demo data
  return new Response(JSON.stringify({
    bookings: [
      // { checkIn: '2026-02-10', checkOut: '2026-02-15' },
    ]
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
};
