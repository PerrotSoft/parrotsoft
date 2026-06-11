export async function GET(request, { params }) {
  try {
    const { id } = await params;

    const masterPlaylist = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=150000,RESOLUTION=256x144
/api/videos/${id}/playlist.m3u8?quality=144p
#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=640x360
/api/videos/${id}/playlist.m3u8?quality=360p
#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=854x480
/api/videos/${id}/playlist.m3u8?quality=480p
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720
/api/videos/${id}/playlist.m3u8?quality=720p
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
/api/videos/${id}/playlist.m3u8?quality=1080p

`;

    return new Response(masterPlaylist, {
      headers: {
        'Content-Type': 'application/x-mpegURL',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      }
    });
  } catch (error) {
    return new Response("Внутренняя ошибка сервера", { status: 500 });
  }
}