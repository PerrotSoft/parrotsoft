// Система "профиля интересов" на 256 параметров — как просили: у каждого
// пользователя и у каждого видео есть вектор из 256 чисел; чем ближе вектор
// видео к вектору пользователя (по косинусному сходству), тем больше видео
// ему рекомендуется. Векторы видео "притягиваются" к векторам тех, кто его
// смотрит/лайкает — то есть чем больше людей с определённым профилем смотрят
// видео, тем сильнее видео приобретает этот профиль, как и просили.
//
// Это НЕ обученная ML-модель (нет ни GPU, ни датасета, ни места для этого в
// Server Actions) — это лёгкий, но честный статистический подход:
//  1. Холодный старт видео: детерминированный хэш-эмбеддинг текста (title +
//     description + tags) — "feature hashing": каждое слово хэшируется в
//     одну из 256 осей, с знаком (+/-) тоже из хэша. Видео с пересекающейся
//     лексикой (одинаковые теги/слова в описании) изначально оказываются
//     близко друг к другу в этом пространстве — без этого понятия
//     "похожести" вообще не было бы, пока никто ничего не посмотрел.
//  2. Дальше вектор видео и вектор пользователя постепенно "притягиваются"
//     друг к другу при просмотре/лайке (экспоненциальное скользящее среднее,
//     небольшой шаг обучения на каждое событие) и отталкиваются при дизлайке.
//     Так профиль видео со временем формируется реальными зрителями, а не
//     только словами в описании.

export const VECTOR_DIMS = 256;

function hashStr(str) {
  // Простой 32-битный хэш (djb2) — детерминированный, без внешних зависимостей.
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

function normalize(vec) {
  let norm = 0;
  for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm < 1e-9) return vec;
  return vec.map(v => v / norm);
}

// Холодный старт: превращает текст (заголовок+описание+теги) в единичный
// вектор на VECTOR_DIMS осей через feature hashing.
export function textToVector(text) {
  const vec = new Array(VECTOR_DIMS).fill(0);
  const words = String(text || '')
    .toLowerCase()
    .replace(/[^a-zа-яё0-9\s#]/gi, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1);
  for (const word of words) {
    const h = hashStr(word);
    const dim = h % VECTOR_DIMS;
    const sign = (h & 0x10000) ? 1 : -1; // знак из другого бита того же хэша
    vec[dim] += sign;
  }
  const normed = normalize(vec);
  // Полностью пустой текст (или без узнаваемых слов) — не оставляем вектор
  // нулевым (косинусное сходство с нулевым вектором не определено/всегда 0,
  // такое видео никогда бы никому не порекомендовалось через персонализацию) —
  // даём случайный, но детерминированный (по хэшу текста) единичный вектор.
  if (normed.every(v => v === 0)) {
    const seed = hashStr(text || 'video');
    let x = seed || 1;
    const rnd = new Array(VECTOR_DIMS).fill(0).map(() => {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      return (x / 0x7fffffff) * 2 - 1;
    });
    return normalize(rnd);
  }
  return normed;
}

export function parseVector(json) {
  if (!json) return null;
  try {
    const arr = JSON.parse(json);
    if (Array.isArray(arr) && arr.length === VECTOR_DIMS) return arr;
  } catch (e) {}
  return null;
}

export function vectorToJson(vec) {
  // Округляем — точность до 4 знаков более чем достаточна для рекомендаций,
  // а строка получается заметно короче.
  return JSON.stringify(vec.map(v => Math.round(v * 10000) / 10000));
}

export function cosineSimilarity(a, b) {
  if (!a || !b) return 0;
  let dot = 0;
  for (let i = 0; i < VECTOR_DIMS; i++) dot += a[i] * b[i];
  return dot; // оба вектора уже единичные (normalize) — dot product = косинусное сходство
}

// Сдвигает вектор `vec` на `weight` в сторону `target` (или от него, если
// weight отрицательный — используется для дизлайков) и перенормирует.
// weight — доля шага: 0.01 = маленький сдвиг (один просмотренный сегмент),
// 0.1+ = заметный сдвиг (лайк/дизлайк).
export function nudge(vec, target, weight) {
  const next = vec.map((v, i) => v + (target[i] - v) * weight);
  return normalize(next);
}
