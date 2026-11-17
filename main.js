// main.js — Этап 2: веб-камера + скелет руки от MediaPipe Hands
import * as THREE from 'three';

// ---------- Элементы страницы ----------
const status = document.getElementById('status');
const video = document.getElementById('cam');
const skeletonCanvas = document.getElementById('skeleton');
const skCtx = skeletonCanvas.getContext('2d'); // "кисть" для рисования на холсте

// ---------- Настройка нейросети ----------
// Hands — класс из hands.min.js. locateFile говорит, откуда брать файлы модели.
const hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`
});

hands.setOptions({
    maxNumHands: 2,          // ДВЕ руки: левая крутит, правая масштабирует
    modelComplexity: 0,      // 0 = лёгкая модель: чуть менее точная, но летает без тормозов
    minDetectionConfidence: 0.5, // порог "уверен, что это рука" (0..1)
    minTrackingConfidence: 0.5   // порог уверенности при слежении за уже найденной рукой
});

// ---------- Что делать с каждым результатом ----------
// MediaPipe вызывает эту функцию после обработки каждого кадра.
// results.multiHandLandmarks — массив рук (до 2), multiHandedness — их метки Left/Right.
hands.onResults((results) => {
    // Подгоняем размер холста под реальный размер кадра видео
    skeletonCanvas.width = video.videoWidth;
    skeletonCanvas.height = video.videoHeight;

    // Стираем прошлый кадр — иначе рисунки наслаиваются
    skCtx.clearRect(0, 0, skeletonCanvas.width, skeletonCanvas.height);

    const handsList = results.multiHandLandmarks || [];
    const handed    = results.multiHandedness  || [];

    if (handsList.length === 0) {
        handVisible = false;
        prevTip = null; // рука пропала — сбрасываем память, иначе куб дёрнется при возврате
        status.textContent = 'Camera on. Show your hands ✋';
        return;
    }
    handVisible = true;

    let hasRotate = false, hasScale = false;

    // Проходим по всем найденным рукам; multiHandedness говорит, левая она или правая
    handsList.forEach((hand, i) => {
        const label = handed[i]?.label; // 'Left' или 'Right'

        // Скелет каждой руки — своим цветом, чтобы видно роли
        const col = label === 'Left' ? '#3a86ff' : '#ff9f3a';
        drawConnectors(skCtx, hand, HAND_CONNECTIONS, { color: col, lineWidth: 2 });
        drawLandmarks(skCtx, hand, { color: '#ffcc44', lineWidth: 1, radius: 3 });

        if (label === 'Left') { hasRotate = true; rotateCube(hand); }   // левая крутит
        else                  { hasScale  = true; scaleCube(hand);  }   // правая масштабирует
    });

    if (!hasRotate) prevTip = null; // вращающая рука ушла из кадра

    status.textContent =
        `Left ✋ rotate: ${hasRotate ? 'tracking' : '—'}   |   ` +
        `Right 🤏 scale: ${hasScale ? 'tracking' : '—'}   |   size ${targetScale.toFixed(1)}x`;
});

// ---------- Запуск камеры ----------
// Делаем вручную (не через camera_utils), чтобы выбрать КОНКРЕТНУЮ камеру —
// утилита MediaPipe умеет только "фронталка/задняя" и может взять телефон.

// Слова, по которым узнаём НЕ ноутбучную камеру (телефон, виртуальные камеры)
const BAD_CAMERA_WORDS = ['droidcam', 'ivcam', 'camo', 'obs', 'virtual', 'phone', 'iphone', 'android', 'epoccam', 'poco'];

// Пауза-помощник
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function pickLaptopCamera() {
    // Шаг 1: запрашиваем разрешение — без него браузер скрывает имена камер
    const tmp = await navigator.mediaDevices.getUserMedia({ video: true });
    tmp.getTracks().forEach(t => t.stop()); // сразу гасим, это был "пропуск"

    // Шаг 2: встроенная камера может "просыпаться" несколько секунд —
    // опрашиваем список до 10 раз с паузой, пока не появится нормальная камера
    for (let attempt = 0; attempt < 10; attempt++) {
        const cams = (await navigator.mediaDevices.enumerateDevices())
            .filter(d => d.kind === 'videoinput');
        console.log(`Попытка ${attempt + 1}. Камеры:`, cams.map(c => c.label));

        // Ищем камеру БЕЗ "плохих" слов в названии — это и есть встроенная
        const good = cams.find(c => !BAD_CAMERA_WORDS.some(w => c.label.toLowerCase().includes(w)));
        if (good) return good;

        await sleep(500); // подождём полсекунды — драйвер камеры просыпается
    }

    // Если так и не появилась — берём первую (телефон), чтобы хоть что-то работало
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
    return cams[0];
}

async function startCamera() {
    const cam = await pickLaptopCamera();
    if (!cam) { status.textContent = 'No cameras found!'; return; }

    // Открываем выбранную камеру и льём её поток в <video>
    video.srcObject = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: cam.deviceId }, width: 320, height: 240 }
    });
    await video.play();
    status.textContent = `Camera: ${cam.label}. Show your hands ✋`;

    // Шаг 4: конвейер — каждый кадр отправляем в нейросеть
    // requestAnimationFrame = "сделай это перед следующим кадром экрана" (~60 раз/сек)
    async function pump() {
        await hands.send({ image: video });
        requestAnimationFrame(pump);
    }
    pump();
}

startCamera().catch((err) => {
    status.textContent = 'No camera access — allow it in the browser and reload.';
    status.style.borderColor = '#c33';
    console.error(err);
});

// ==================================================================
// ЭТАП 4: жесты → куб (переменные; функция controlCube — внизу файла,
// после создания куба, т.к. она им управляет)
// ==================================================================
let prevTip = null;      // позиция указательного пальца в прошлом кадре
let handVisible = false; // видна ли рука прямо сейчас (для "покоя" куба)
const ROT_SPEED = 6;     // чувствительность вращения (больше = резче)
const PINCH_MIN = 0.07;  // дистанция "пальцы сомкнуты" — порог щипка

// --- ЭТАП 5: цели для плавной интерполяции ---
// Жесты пишут сюда "куда стремиться", animate() плавно догоняет
let targetRotX = 0, targetRotY = 0, targetScale = 1;
let pinchMode = false;        // режим щипка (для цвета куба)
const SMOOTH = 0.12;          // скорость догоняния: 0.05 масло .. 0.3 резко

// ==================================================================
// ЭТАП 3: 3D-сцена — куб на весь экран
// ==================================================================

// --- Сцена и камера ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f14); // цвет фона (тот же тёмный, что в CSS)

// PerspectiveCamera(угол обзора в градусах, соотношение сторон, ближняя и дальняя плоскость)
// Ближняя/дальняя плоскости = границы видимости: ближе 0.1 или дальше 100 не рисуем.
const camera3d = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 100);
camera3d.position.z = 5; // отодвигаем "глаз" от центра на 5 единиц, иначе мы внутри куба

// --- Рендерер: рисует сцену на canvas внутри #scene3d ---
const renderer = new THREE.WebGLRenderer({ antialias: true }); // antialias = сглаженные края
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(devicePixelRatio); // чётко на retina/высоком DPI
document.getElementById('scene3d').appendChild(renderer.domElement);

// --- Объект: куб ---
// Mesh = Геометрия (форма) + Материал (вид поверхности)
const cube = new THREE.Mesh(
    new THREE.BoxGeometry(2, 2, 2),                 // куб со стороной 2
    new THREE.MeshStandardMaterial({ color: 0x3a86ff, roughness: 0.35, metalness: 0.4 })
);
scene.add(cube);

// Тонкая светлая "окантовка" граней — куб читается лучше, стиль как у голограммы
const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(cube.geometry),
    new THREE.LineBasicMaterial({ color: 0x9ad1ff })
);
cube.add(edges); // кантовка привязана к кубу — будет крутиться вместе с ним

// --- Свет: без него материал Standard выглядел бы чёрным пятном ---
scene.add(new THREE.AmbientLight(0xffffff, 0.5));           // общая мягкая подсветка
const lamp = new THREE.DirectionalLight(0xffffff, 1.2);     // "лампа" с направлением
lamp.position.set(3, 4, 5);
scene.add(lamp);

// --- ЛЕВАЯ рука: вращение по смещению указательного пальца ---
function rotateCube(hand) {
    const index = hand[8];
    if (!index) return;

    if (prevTip) {
        const dx = index.x - prevTip.x; // сдвиг пальца по горизонтали
        const dy = index.y - prevTip.y; // сдвиг по вертикали

        targetRotY += dx * ROT_SPEED; // накапливаем в цели, не в куб напрямую
        targetRotX += dy * ROT_SPEED;
        // Ограничим наклон, чтобы куб не заваливался "на спину"
        targetRotX = THREE.MathUtils.clamp(targetRotX, -1.4, 1.4);
    }
    prevTip = { x: index.x, y: index.y }; // запомнили для следующего кадра
}

// --- ПРАВАЯ рука: масштаб = расстояние большой↔указательный (щипок) ---
function scaleCube(hand) {
    const thumb = hand[4];
    const index = hand[8];
    if (!thumb || !index) return;

    // Math.hypot(dx, dy) = sqrt(dx²+dy²) — обычная теорема Пифагора
    const pinchDist = Math.hypot(index.x - thumb.x, index.y - thumb.y);

    // Переводим дистанцию (~0.03 сомкнуто .. ~0.25 разведено) в ЦЕЛЬ масштаба
    targetScale = THREE.MathUtils.clamp((pinchDist - 0.03) * 12, 0.3, 2.5);
    pinchMode = pinchDist < PINCH_MIN; // для цвета куба
}

// --- ЭТАП 5: звёздное поле позади куба (просто точки в случайных местах) ---
const starGeo = new THREE.BufferGeometry();
const starPos = new Float32Array(300 * 3); // 300 звёзд × 3 координаты
for (let i = 0; i < starPos.length; i++) {
    starPos[i] = (Math.random() - 0.5) * 30; // случайно от -15 до 15
}
starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
    color: 0x4a6a9a, size: 0.06
}));
scene.add(stars);

// Цвета режимов: вращение — синий, щипок — оранжевый
const COLOR_ROTATE = new THREE.Color(0x3a86ff);
const COLOR_PINCH  = new THREE.Color(0xff9f3a);

// --- Цикл отрисовки ---
function animate() {
    requestAnimationFrame(animate);

    // Плавное догоняние: каждый кадр сдвигаемся на 12% пути к цели
    cube.rotation.x += (targetRotX - cube.rotation.x) * SMOOTH;
    cube.rotation.y += (targetRotY - cube.rotation.y) * SMOOTH;
    const s = cube.scale.x + (targetScale - cube.scale.x) * SMOOTH;
    cube.scale.setScalar(s);

    // Цвет плавно перетекает под режим
    cube.material.color.lerp(pinchMode ? COLOR_PINCH : COLOR_ROTATE, 0.15);

    if (!handVisible) targetRotY += 0.004; // "демо-режим": медленное вращение в покое
    stars.rotation.y += 0.0006;            // лёгкий дрейф звёзд для живости

    renderer.render(scene, camera3d); // "сфотографировать" сцену и показать
}
animate();

// Если окно меняет размер — подгоняем камеру и холст, иначе картинка сплющится
addEventListener('resize', () => {
    camera3d.aspect = innerWidth / innerHeight;
    camera3d.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
});

// Диагностика: если это напечаталось — код дошёл до конца, canvas создан
console.log('3D init OK. canvas:', renderer.domElement, 'size:', renderer.domElement.width, 'x', renderer.domElement.height);
