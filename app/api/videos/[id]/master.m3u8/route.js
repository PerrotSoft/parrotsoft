export async function GET(request, { params }) {
  try {
    const { id } = await params;

    // Плеер сам выберет нужную ссылку в зависимости от ширины канала пользователя
    const masterPlaylist = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=854x480
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