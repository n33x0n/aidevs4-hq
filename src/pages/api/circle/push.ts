import type { APIRoute } from 'astro';

// Dane z Circle.so przesłane przez bookmarklet (przeglądarka → agent)
let latestData: { posts: any[]; comments: any[]; dms: any[]; timestamp: number } | null = null;

export function getLatestData() {
  return latestData;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json() as {
      posts?: any[];
      comments?: any[];
      dms?: any[];
    };

    latestData = {
      posts: body.posts || [],
      comments: body.comments || [],
      dms: body.dms || [],
      timestamp: Date.now(),
    };

    console.log(`[PUSH] Otrzymano: ${latestData.posts.length} postów, ${latestData.comments.length} komentarzy, ${latestData.dms.length} DM-ów`);

    return new Response(
      JSON.stringify({
        success: true,
        counts: {
          posts: latestData.posts.length,
          comments: latestData.comments.length,
          dms: latestData.dms.length,
        },
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
};

// CORS preflight
export const OPTIONS: APIRoute = async () => {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
};
