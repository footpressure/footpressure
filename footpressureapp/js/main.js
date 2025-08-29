// 传感器坐标（与原Python程序一致）
const sensorCoords = [
    [98.4909, 211.439], [100.7945, 178.4249], [66.6567, 175.9563], [82.986, 178.8826],
    [33.2587, 162.0871], [49.8978, 168.845], [42.0029, 113.2988], [77.0211, 114.4686],
    [59.1284, 41.3161], [70.285, 53.3156], [68.8198, 24.8434], [47.2946, 24.5495],
    [47.5886, 53.3203], [59.6174, 82.9056], [49.0136, 147.1317], [77.8881, 151.4722]
];

// 配置参数
const canvasWidth = 120;
const canvasHeight = 300;
const sigma = 20;
let frameInterval = 1000; // 帧间隔（毫秒）

// 全局变量
let dataFrames = []; // 所有帧数据
let copTraj = []; // COP轨迹
let currentFrame = 0;
let animationId = null;
let isPlaying = true;

// 初始化ECharts实例
const heatmapChart = echarts.init(document.getElementById('heatmap'));
const copChart = echarts.init(document.getElementById('copTrajectory'));

// 读取JSON数据
fetch('data/pressure_data.json')
    .then(response => response.json())
    .then(data => {
        dataFrames = data;
        // 计算COP轨迹
        copTraj = calculateCopTrajectory(dataFrames);
        // 初始化图表
        initCharts();
        // 开始动画
        startAnimation();
    })
    .catch(error => console.error('数据加载失败:', error));

// 初始化图表配置
function initCharts() {
    // 热图配置
    heatmapChart.setOption({
        tooltip: { trigger: 'item' },
        visualMap: {
            min: 0,
            max: 1500,
            type: 'continuous',
            orient: 'horizontal',
            bottom: 10,
            left: 'center',
            itemWidth: 300,
            itemHeight: 20,
            label: { show: true }
        },
        grid: { left: 10, right: 10, top: 30, bottom: 50 },
        xAxis: { type: 'value', min: 0, max: canvasWidth, show: false },
        yAxis: { type: 'value', min: 0, max: canvasHeight, show: false },
        series: [{
            type: 'heatmap',
            data: [],
            roam: false,
            label: { show: false }
        }, {
            type: 'scatter', // 传感器位置标记
            symbolSize: 8,
            itemStyle: { color: 'white' },
            data: sensorCoords.map(([x, y]) => [x, y])
        }, {
            type: 'scatter', // 当前COP点
            id: 'copDot',
            symbolSize: 10,
            itemStyle: { color: 'red' },
            data: []
        }]
    });

    // COP轨迹图配置
    copChart.setOption({
        tooltip: { trigger: 'item' },
        grid: { left: '10%', right: '10%', top: 30, bottom: 30 },
        xAxis: { type: 'value', min: 0, max: canvasWidth, name: 'X位置' },
        yAxis: { type: 'value', min: 0, max: canvasHeight, name: 'Y位置' },
        series: [{
            type: 'line', // COP轨迹线
            id: 'copLine',
            symbol: 'none',
            lineStyle: { color: 'blue' },
            data: []
        }, {
            type: 'line', // 协方差椭圆
            id: 'ellipseLine',
            symbol: 'none',
            lineStyle: { color: 'red', type: 'dashed' },
            data: []
        }]
    });
}

// 生成热图数据（适配ECharts格式）
function generateHeatmapFrame(zValues) {
    const data = [];
    // 简化计算：只在传感器附近生成热力点（避免全量计算）
    for (let i = 0; i < sensorCoords.length; i++) {
        const [x, y] = sensorCoords[i];
        const z = zValues[i];
        // 生成传感器周围3*sigma范围内的点
        for (let dy = -3 * sigma; dy <= 3 * sigma; dy++) {
            for (let dx = -3 * sigma; dx <= 3 * sigma; dx++) {
                const cx = x + dx;
                const cy = y + dy;
                if (cx < 0 || cx >= canvasWidth || cy < 0 || cy >= canvasHeight) continue;
                const distanceSq = dx * dx + dy * dy;
                const contribution = z * Math.exp(-distanceSq / (2 * sigma * sigma));
                data.push([cx, cy, contribution]);
            }
        }
    }
    return data;
}

// 计算COP轨迹
function calculateCopTrajectory(frames) {
    return frames.map(zValues => {
        const sumZ = zValues.reduce((a, b) => a + b, 0);
        if (sumZ === 0) return [NaN, NaN];
        let cx = 0, cy = 0;
        zValues.forEach((z, i) => {
            cx += sensorCoords[i][0] * z;
            cy += sensorCoords[i][1] * z;
        });
        return [cx / sumZ, cy / sumZ];
    });
}

// 计算协方差椭圆
function calculateEllipse(validPoints) {
    if (validPoints.length < 3) return [];
    // 计算均值
    const mean = validPoints.reduce(([mx, my], [x, y]) => [mx + x, my + y], [0, 0])
        .map(v => v / validPoints.length);
    // 计算协方差矩阵
    const cov = [[0, 0], [0, 0]];
    validPoints.forEach(([x, y]) => {
        const dx = x - mean[0], dy = y - mean[1];
        cov[0][0] += dx * dx;
        cov[0][1] += dx * dy;
        cov[1][0] += dx * dy;
        cov[1][1] += dy * dy;
    });
    cov.forEach((row, i) => row.forEach((val, j) => cov[i][j] /= validPoints.length - 1));
    // 计算特征值和特征向量（简化版，实际可引入math.js优化）
    const trace = cov[0][0] + cov[1][1];
    const det = cov[0][0] * cov[1][1] - cov[0][1] * cov[1][0];
    const sqrtVal = Math.sqrt(trace * trace / 4 - det);
    const D = [trace / 2 + sqrtVal, trace / 2 - sqrtVal]; // 特征值
    const V = [[1, -cov[0][0] + trace / 2 - sqrtVal], [cov[0][1], cov[0][1]]]; // 简化特征向量
    // 生成椭圆点
    const theta = Array.from({ length: 100 }, (_, i) => i * 2 * Math.PI / 100);
    return theta.map(t => {
        const x = 2.45 * Math.sqrt(D[0]) * Math.cos(t) * V[0][0]
            + 2.45 * Math.sqrt(D[1]) * Math.sin(t) * V[0][1]
            + mean[0];
        const y = 2.45 * Math.sqrt(D[0]) * Math.cos(t) * V[1][0]
            + 2.45 * Math.sqrt(D[1]) * Math.sin(t) * V[1][1]
            + mean[1];
        return [x, y];
    });
}

// 更新当前帧
function updateFrame(frame) {
    if (frame >= dataFrames.length) frame = 0;
    currentFrame = frame;
    document.getElementById('frameNum').textContent = frame + 1;

    // 更新热图
    const zValues = dataFrames[frame];
    const heatmapData = generateHeatmapFrame(zValues);
    heatmapChart.setOption({
        series: [{
            type: 'heatmap',
            data: heatmapData
        }, {
            id: 'copDot',
            data: [copTraj[frame]]
        }]
    });

    // 更新COP轨迹
    const validPoints = copTraj.slice(0, frame + 1).filter(([x, y]) => !isNaN(x) && !isNaN(y));
    copChart.setOption({
        series: [{
            id: 'copLine',
            data: validPoints
        }, {
            id: 'ellipseLine',
            data: calculateEllipse(validPoints)
        }]
    });
}

// 动画控制
function startAnimation() {
    if (animationId) clearInterval(animationId);
    animationId = setInterval(() => {
        updateFrame(currentFrame + 1);
    }, frameInterval);
}

function pauseAnimation() {
    clearInterval(animationId);
    animationId = null;
}

// 绑定按钮事件
document.getElementById('playPause').addEventListener('click', () => {
    if (isPlaying) {
        pauseAnimation();
        document.getElementById('playPause').textContent = '播放';
    } else {
        startAnimation();
        document.getElementById('playPause').textContent = '暂停';
    }
    isPlaying = !isPlaying;
});

document.getElementById('replay').addEventListener('click', () => {
    pauseAnimation();
    updateFrame(0);
    startAnimation();
    isPlaying = true;
    document.getElementById('playPause').textContent = '暂停';
});

// 窗口大小变化时重绘图表
window.addEventListener('resize', () => {
    heatmapChart.resize();
    copChart.resize();
});