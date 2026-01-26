import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const formData = await request.formData();

    const file = formData.get('file') as File;
    const category = formData.get('category') as string || 'sonstiges';
    const name = formData.get('name') as string || '';
    const description = formData.get('description') as string || '';
    const type = formData.get('type') as string || 'image';

    if (!file) {
      return new Response(JSON.stringify({ error: 'Keine Datei hochgeladen' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Validate file type
    const allowedImageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif'];
    const allowedVideoTypes = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo'];

    const isValidType = type === 'image'
      ? allowedImageTypes.includes(file.type)
      : allowedVideoTypes.includes(file.type);

    if (!isValidType) {
      return new Response(JSON.stringify({ error: 'Dateityp nicht unterstützt' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Generate unique filename
    const ext = file.name.split('.').pop() || 'jpg';
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const filename = `${category}/${timestamp}-${random}.${ext}`;

    // PLACEHOLDER: Upload to Cloudflare R2
    // When R2 is configured:
    // const bucket = locals.runtime.env.GALLERY_BUCKET;
    // await bucket.put(filename, file.stream(), {
    //   httpMetadata: { contentType: file.type }
    // });
    // const url = `https://gallery.garten.infinityspace42.de/${filename}`;

    // PLACEHOLDER: Create thumbnail for images
    // Using Cloudflare Images or a Worker to resize

    // PLACEHOLDER: Save metadata to D1
    // await locals.runtime.env.DB.prepare(
    //   `INSERT INTO gallery_images (id, url, thumbnail_url, name, description, category, type, uploaded_at)
    //    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    // ).bind(
    //   `${timestamp}-${random}`,
    //   url,
    //   thumbnailUrl,
    //   name || file.name,
    //   description,
    //   category,
    //   type
    // ).run();

    console.log('Gallery upload:', {
      filename,
      category,
      name: name || file.name,
      description,
      type,
      size: file.size,
    });

    // For now, return success (actual storage needs R2 setup)
    return new Response(JSON.stringify({
      success: true,
      message: 'Datei erfolgreich hochgeladen',
      // id: `${timestamp}-${random}`,
      // url: url,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Upload error:', error);
    return new Response(JSON.stringify({ error: 'Interner Fehler beim Upload' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

// Max file size configuration (50MB)
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
};
