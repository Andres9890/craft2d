const GameLoaded = new CustomEvent("GameLoaded", {
    detail: {
        message: "Doodle Jump mode ready.",
        timestamp: new Date(),
    }
});

const doodle = {
    bounds: { left: -16, right: 16 },
    platforms: [],
    platformThickness: 0.28,
    spacing: { min: 1.6, max: 2.4 },
    baseBounce: 12.5,
    baseSpringMultiplier: 1.35,
    highestHeight: 0,
    cameraTop: 0,
    startY: 0,
    nextPlatformY: 0,
    gameOver: false,
    restartHeld: false,
    score: 0,
    bestScore: parseInt(localStorage.getItem('doodle.bestScore') || '0', 10) || 0,
    lastScoreShown: -1,
    lastBestShown: -1,
    lastFrameTime: performance.now(),
};

document.body.style.margin = '0';
document.body.style.backgroundColor = '#030712';
document.body.style.overflow = 'hidden';

const hudElements = createHud();
const overlayElements = createOverlay();

function createHud() {
    const hud = document.createElement('div');
    hud.className = 'doodle-hud';
    hud.innerHTML = `
        <div class="doodle-hud__row">
            <span class="doodle-hud__label">Score</span>
            <span class="doodle-hud__value" data-role="score">0</span>
        </div>
        <div class="doodle-hud__row">
            <span class="doodle-hud__label">Best</span>
            <span class="doodle-hud__value" data-role="best">0</span>
        </div>
    `;
    document.body.appendChild(hud);
    return {
        container: hud,
        score: hud.querySelector('[data-role="score"]'),
        best: hud.querySelector('[data-role="best"]')
    };
}

function createOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'doodle-gameover';
    overlay.innerHTML = `
        <div class="doodle-gameover__panel">
            <h1>Doodle Jump</h1>
            <p class="doodle-gameover__score">Score: <span data-role="final-score">0</span></p>
            <p class="doodle-gameover__score">Best: <span data-role="final-best">0</span></p>
            <p class="doodle-gameover__hint" data-role="hint">Press Space to jump again</p>
        </div>
    `;
    overlay.style.display = 'none';
    document.body.appendChild(overlay);
    return {
        container: overlay,
        score: overlay.querySelector('[data-role="final-score"]'),
        best: overlay.querySelector('[data-role="final-best"]'),
        hint: overlay.querySelector('[data-role="hint"]')
    };
}

function randomBetween(min, max) {
    return Math.random() * (max - min) + min;
}

function pickPlatformType(height) {
    if (height <= doodle.startY + 3) return 'normal';
    const progress = Math.min(1, (height - doodle.startY) / 80);
    let roll = Math.random();

    const springChance = 0.08 + progress * 0.12;
    if (roll < springChance) return 'spring';
    roll -= springChance;

    const movingChance = 0.15 + progress * 0.25;
    if (roll < movingChance) return 'moving';
    roll -= movingChance;

    const breakChance = 0.1 + progress * 0.25;
    if (roll < breakChance) return 'break';

    return 'normal';
}

function spawnPlatform(y, options = {}) {
    const maxWidth = Math.max(1.6, 3.2 - Math.max(0, (y - doodle.startY) / 60));
    const width = options.width ?? randomBetween(1.4, maxWidth);
    const minX = doodle.bounds.left;
    const maxX = doodle.bounds.right - width;
    const x = options.x ?? randomBetween(minX, maxX);
    const type = options.type ?? pickPlatformType(y);
    const platform = {
        x,
        y,
        width,
        thickness: options.thickness ?? doodle.platformThickness,
        type,
        dx: options.dx ?? (type === 'moving' ? (Math.random() < 0.5 ? -1 : 1) * randomBetween(0.7, 1.1) : 0),
        state: 'idle',
        breakTimer: 0,
        springTimer: 0,
        active: true,
    };
    doodle.platforms.push(platform);
    doodle.topPlatformY = Math.max(doodle.topPlatformY ?? y, platform.y);
    return platform;
}

function ensurePlatforms() {
    const viewHeight = window.innerHeight / (64 * camera.scale);
    const targetY = doodle.cameraTop + viewHeight * 2;
    while (doodle.nextPlatformY < targetY) {
        spawnPlatform(doodle.nextPlatformY);
        doodle.nextPlatformY += randomBetween(doodle.spacing.min, doodle.spacing.max);
    }
}

function updatePlatforms(delta) {
    const horizontalRange = doodle.bounds;
    doodle.platforms = doodle.platforms.filter(platform => {
        if (!platform.active) {
            return false;
        }

        if (platform.type === 'moving') {
            platform.x += platform.dx * delta;
            if (platform.x < horizontalRange.left) {
                platform.x = horizontalRange.left;
                platform.dx *= -1;
            } else if (platform.x + platform.width > horizontalRange.right) {
                platform.x = horizontalRange.right - platform.width;
                platform.dx *= -1;
            }
        }

        if (platform.type === 'break' && platform.state === 'breaking') {
            platform.breakTimer += delta;
            if (platform.breakTimer >= 0.35) {
                platform.active = false;
                return false;
            }
        }

        if (platform.type === 'spring' && platform.springTimer > 0) {
            platform.springTimer = Math.max(0, platform.springTimer - delta);
        }

        if (platform.y < doodle.highestHeight - 30) {
            return false;
        }

        return true;
    });
}

function handlePlatformCollisions(previousBottom) {
    if (player.my >= 0) return; // only when falling (negative velocity)

    const playerLeft = player.x;
    const playerRight = player.x + 1;
    const playerBottom = player.y - 1;

    for (const platform of doodle.platforms) {
        if (!platform.active) continue;
        if (playerRight <= platform.x || playerLeft >= platform.x + platform.width) continue;

        const platformTop = platform.y;
        if (previousBottom >= platformTop && playerBottom <= platformTop + platform.thickness) {
            if (player.y <= platformTop) continue; // approaching from below

            player.y = platformTop + 1;
            player.air = false;
            let bounce = doodle.baseBounce;
            if (platform.type === 'spring') {
                bounce *= doodle.baseSpringMultiplier;
                platform.springTimer = 0.25;
            }
            player.my = bounce;
            if (platform.type === 'break') {
                platform.state = 'breaking';
                platform.breakTimer = 0;
            }
            return;
        }
    }
}

function constrainPlayerHorizontal() {
    const leftBound = doodle.bounds.left;
    const rightBound = doodle.bounds.right - 1;
    if (player.x < leftBound) {
        player.x = leftBound;
        if (player.mx < 0) player.mx = 0;
    }
    if (player.x > rightBound) {
        player.x = rightBound;
        if (player.mx > 0) player.mx = 0;
    }
}

function updateCamera(delta) {
    const viewWidth = window.innerWidth / (64 * camera.scale);
    const viewHeight = window.innerHeight / (64 * camera.scale);

    const desiredX = player.x + 0.5 - viewWidth / 2;
    camera.x += (desiredX - camera.x) * Math.min(1, delta * 10);

    const desiredTop = Math.max(doodle.cameraTop, player.y + viewHeight * 0.7);
    doodle.cameraTop = desiredTop;
    camera.y += (desiredTop - camera.y) * Math.min(1, delta * 5);
}

function updateScore() {
    doodle.highestHeight = Math.max(doodle.highestHeight, player.y);
    const newScore = Math.max(0, Math.floor((doodle.highestHeight - doodle.startY) * 10));
    if (newScore !== doodle.score) {
        doodle.score = newScore;
    }
    if (doodle.score > doodle.bestScore) {
        doodle.bestScore = doodle.score;
        localStorage.setItem('doodle.bestScore', doodle.bestScore.toString());
    }
}

function updateHud() {
    if (doodle.score !== doodle.lastScoreShown) {
        hudElements.score.textContent = doodle.score.toString();
        doodle.lastScoreShown = doodle.score;
    }
    if (doodle.bestScore !== doodle.lastBestShown) {
        hudElements.best.textContent = doodle.bestScore.toString();
        overlayElements.best.textContent = doodle.bestScore.toString();
        doodle.lastBestShown = doodle.bestScore;
    }
}

function drawBackground() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx = globalCtx;
    const progress = Math.min(1, (doodle.highestHeight - doodle.startY) / 100);
    const topHue = 210 - progress * 40;
    const bottomHue = 195 - progress * 30;
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, `hsl(${topHue}, 80%, ${35 + progress * 10}%)`);
    gradient.addColorStop(1, `hsl(${bottomHue}, 70%, ${55 + progress * 15}%)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawPlatforms() {
    const ctx = globalCtx;
    for (const platform of doodle.platforms) {
        if (!platform.active) continue;
        const relX = (platform.x - camera.x) * 64 * camera.scale;
        const relY = (camera.y - platform.y) * 64 * camera.scale;
        const widthPx = platform.width * 64 * camera.scale;
        const heightPx = Math.max(2, platform.thickness * 64 * camera.scale);

        let color = '#e8f1ff';
        if (platform.type === 'spring') {
            color = '#ffd166';
        } else if (platform.type === 'moving') {
            color = '#80ed99';
        } else if (platform.type === 'break') {
            color = '#ff6b6b';
        } else if (platform.type === 'base') {
            color = '#5dd39e';
        }

        ctx.save();
        if (platform.type === 'break' && platform.state === 'breaking') {
            ctx.globalAlpha = Math.max(0, 1 - platform.breakTimer / 0.35);
        }
        if (platform.type === 'spring' && platform.springTimer > 0) {
            const scale = 1 + platform.springTimer * 1.2;
            ctx.fillStyle = color;
            ctx.fillRect(relX, relY - (scale - 1) * heightPx, widthPx, heightPx * scale);
            ctx.restore();
            continue;
        }
        ctx.fillStyle = color;
        ctx.fillRect(relX, relY, widthPx, heightPx);
        ctx.restore();
    }
}

function drawFrame() {
    drawBackground();
    drawPlatforms();
    renderPlayer(globalCtx, camera.x, camera.y);
    updateHud();
    if (doodle.gameOver) {
        overlayElements.container.style.display = 'flex';
        overlayElements.score.textContent = doodle.score.toString();
    } else {
        overlayElements.container.style.display = 'none';
    }
}

function checkGameOver() {
    const viewHeight = window.innerHeight / (64 * camera.scale);
    const bottomVisible = camera.y - viewHeight;
    if (player.y - 1 < bottomVisible - 2) {
        triggerGameOver();
    }
}

function triggerGameOver() {
    if (doodle.gameOver) return;
    doodle.gameOver = true;
    player.controlAllowed = false;
    player.mx = 0;
    player.my = 0;
    overlayElements.score.textContent = doodle.score.toString();
}

function resetGame() {
    env.global.worldGenType = 'none';
    env.global.worldBottomEnabled = false;
    env.global.lightEnabled = false;
    env.global.mobsEnabled = false;
    env.global.baseGravity = -0.55;
    env.global.gravity = env.global.baseGravity;
    env.global.baseSpeedVelocity = 8;
    env.global.baseJumpVelocity = 12.4;

    player.inventory.clearAll?.();
    player.controlAllowed = true;
    player.modificationAllowed = false;
    player.fly = false;
    player.noclip = true;
    player.regenAllowed = false;
    player.speedMult = 1;
    player.jumpMult = 1;
    player.x = 0;
    player.y = 4;
    player.mx = 0;
    player.my = doodle.baseBounce;
    player.air = false;
    player.health = player.maxHealth;

    camera.scale = 1;
    const viewHeight = window.innerHeight / (64 * camera.scale);
    camera.x = player.x + 0.5 - (window.innerWidth / (64 * camera.scale)) / 2;
    camera.y = player.y + viewHeight * 0.7;
    doodle.cameraTop = camera.y;

    doodle.platforms = [];
    doodle.score = 0;
    doodle.highestHeight = player.y;
    doodle.startY = player.y;
    doodle.nextPlatformY = 2.5;
    doodle.topPlatformY = 0;
    doodle.gameOver = false;
    doodle.restartHeld = true;
    doodle.lastScoreShown = -1;
    doodle.lastBestShown = -1;

    spawnPlatform(0, { x: -2, width: 4, type: 'base' });
    ensurePlatforms();

    overlayElements.container.style.display = 'none';
    overlayElements.score.textContent = '0';
    overlayElements.best.textContent = doodle.bestScore.toString();
    updateHud();

    doodle.lastFrameTime = performance.now();
    client.lastRenderTick = performance.now();
    client.lastGameTick = performance.now();
}

function renderTick() {
    const now = performance.now();
    const delta = (now - doodle.lastFrameTime) / 1000;
    doodle.lastFrameTime = now;

    client.renderTickrateComputed = Math.round(1000 / (now - client.lastRenderTick));
    if (client.renderTickrateComputed < 5) {
        client.renderTickrateComputed = 5;
    }
    client.lastRenderTick = now;

    if (!doodle.gameOver) {
        updateMovementKeys();
        updateCommonValues();
        const previousBottom = player.y - 1;
        playerPhysics(player);
        handlePlatformCollisions(previousBottom);
        constrainPlayerHorizontal();
        updatePlatforms(delta);
        ensurePlatforms();
        updateCamera(delta);
        updateScore();
        checkGameOver();
    } else {
        if (!keys.Space && !keys.Enter) {
            doodle.restartHeld = false;
        }
        if (!doodle.restartHeld && (keys.Space || keys.Enter)) {
            doodle.restartHeld = true;
            resetGame();
        }
    }

    drawFrame();
    env.global.renderTickNum++;
    client.oldMx = client.mx;
    client.oldMy = client.my;
    requestAnimationFrame(renderTick);
}

resetGame();
document.dispatchEvent(GameLoaded);
requestAnimationFrame(renderTick);

