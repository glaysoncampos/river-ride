// script.js — AI RAID (River Raid estilo)
// TUDO INLINE: sem fetch, sem imagens externas

(() => {
    // ---------- CONFIGURAÇÕES DO JSON (INLINE) ----------
    const CONFIG = {
        "velocidade_base": 3.5,
        "combustivel_inicial": 100,
        "consumo_combustivel": 0.12,
        "spawn_intervalo_frames": 32,
        "pontos_texto": 150,
        "pontos_video": 100,
        "double_multiplier": 2,
        "alertas": {
            "primeiro_contato_video": "⚠️ OVERHEAT 50%",
            "segundo_contato_video": "💥 SISTEMA QUEIMADO"
        }
    };

    // ---------- NOMES DAS IAS (INLINE) ----------
    const TEXT_AI_NAMES = ["GPT", "Gemini", "Llama", "Claude"];
    const VIDEO_AI_NAMES = ["Sora", "Runway", "Kling", "Haiper"];

    // ---------- CONSTANTES DO JOGO ----------
    const CANVAS_WIDTH = 600, CANVAS_HEIGHT = 600;
    const PLAYER_WIDTH = 26, PLAYER_HEIGHT = 20;
    const ENEMY_SIZE = 32; // altura dos inimigos

    // ---------- ESTADO GLOBAL ----------
    let canvas, ctx;
    let fuel = CONFIG.combustivel_inicial;
    let score = 0;
    let gameOver = false;
    let gameWin = false;   // só para mensagem (não usado no loop)
    let frames = 0;

    // Posição do jogador (no eixo X), Y é fixo próximo à base
    let playerX = CANVAS_WIDTH / 2;

    // Listas de entidades
    let enemies = [];          // { type: 'text' ou 'video', x, y, name, icon }
    let bullets = [];          // { x, y }
    let powerUps = [];         // { x, y, active }

    // Power-up shield
    let shieldActive = false;
    let shieldCounter = 0;      // frames restantes (10s = 600 frames a 60fps)
    const SHIELD_DURATION = 600; // 10s * 60

    // Flag de alerta visual de primeiro dano de vídeo
    let videoHitWarning = false;        // se sofreu 1° contato recente
    let videoHitWarningFrames = 0;      // tempo que mostra alerta
    let lastContactWasVideo = false;    // para sequência: 2° erro seguido?

    // Flags para não repetir explosão
    let exploded = false;

    // Input
    let keys = { left: false, right: false, space: false };
    let canShoot = true;
    const SHOT_COOLDOWN = 12; // frames entre tiros
    let shotCooldownCounter = 0;

    // Elementos DOM
    const fuelSpan = document.getElementById('fuelValue');
    const scoreSpan = document.getElementById('scoreValue');
    const shieldSpan = document.getElementById('shieldTimer');
    const alertBox = document.getElementById('alertBox');

    // ---------- INICIALIZAÇÃO ----------
    window.addEventListener('load', () => {
        canvas = document.getElementById('gameCanvas');
        ctx = canvas.getContext('2d');
        requestAnimationFrame(gameLoop);
    });

    // ---------- CONTROLES ----------
    window.addEventListener('keydown', (e) => {
        if (e.key === ' ' || e.code === 'Space') {
            e.preventDefault();
            keys.space = true;
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            keys.left = true;
        } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            keys.right = true;
        }
    });

    window.addEventListener('keyup', (e) => {
        if (e.key === ' ' || e.code === 'Space') {
            e.preventDefault();
            keys.space = false;
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            keys.left = false;
        } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            keys.right = false;
        }
    });

    // ---------- FUNÇÕES AUXILIARES ----------
    function spawnEnemy() {
        const type = Math.random() < 0.6 ? 'text' : 'video'; // 60% texto, 40% video
        let name, icon, color;
        if (type === 'text') {
            name = TEXT_AI_NAMES[Math.floor(Math.random() * TEXT_AI_NAMES.length)];
            icon = '💬';
        } else {
            name = VIDEO_AI_NAMES[Math.floor(Math.random() * VIDEO_AI_NAMES.length)];
            icon = '▶️';
        }
        const x = 30 + Math.random() * (CANVAS_WIDTH - 80);
        const y = -ENEMY_SIZE; // topo
        enemies.push({ type, name, icon, x, y, w: 44, h: ENEMY_SIZE });
    }

    function spawnPowerUp() {
        // raridade: a cada 180 frames ~ 3 segundos (opcional)
        if (frames % 180 === 17 && !gameOver) { 
            const x = 50 + Math.random() * (CANVAS_WIDTH - 100);
            powerUps.push({ x, y: -30, active: true });
        }
    }

    function updateMovement() {
        if (gameOver) return;

        // mover jogador
        const MOVE_SPEED = 5.5;
        if (keys.left) playerX = Math.max(20, playerX - MOVE_SPEED);
        if (keys.right) playerX = Math.min(CANVAS_WIDTH - 20, playerX + MOVE_SPEED);

        // tiro
        if (keys.space && canShoot && !gameOver) {
            bullets.push({ x: playerX, y: CANVAS_HEIGHT - 70 });
            canShoot = false;
            shotCooldownCounter = SHOT_COOLDOWN;
        }
        if (!canShoot) {
            shotCooldownCounter--;
            if (shotCooldownCounter <= 0) canShoot = true;
        }

        // scroll dos inimigos (movem pra baixo)
        for (let i = enemies.length - 1; i >= 0; i--) {
            const e = enemies[i];
            e.y += CONFIG.velocidade_base;
            if (e.y > CANVAS_HEIGHT + 50) {
                enemies.splice(i, 1); // sumir se passou
            }
        }

        // scroll powerups
        for (let i = powerUps.length - 1; i >= 0; i--) {
            const p = powerUps[i];
            p.y += CONFIG.velocidade_base;
            if (p.y > CANVAS_HEIGHT + 30) powerUps.splice(i, 1);
        }

        // balas (movem pra cima)
        for (let i = bullets.length - 1; i >= 0; i--) {
            bullets[i].y -= 7;
            if (bullets[i].y < -20) bullets.splice(i, 1);
        }

        // consumo combustível
        fuel = Math.max(0, fuel - CONFIG.consumo_combustivel);
        if (fuel <= 0) { gameOver = true; alertBox.innerText = 'SEM COMBUSTÍVEL'; }

        // shield timer
        if (shieldActive) {
            shieldCounter--;
            shieldSpan.innerText = (shieldCounter / 60).toFixed(1);
            if (shieldCounter <= 0) {
                shieldActive = false;
                shieldSpan.innerText = '0';
            }
        }

        // alerta visual piscante (primeiro contato) diminui
        if (videoHitWarningFrames > 0) {
            videoHitWarningFrames--;
            if (videoHitWarningFrames === 0) {
                videoHitWarning = false;
                alertBox.innerText = '';
            }
        }
    }

    function handleCollisions() {
        if (gameOver) return;

        // Área do jogador (retângulo de colisão)
        const playerRect = {
            x: playerX - 18,
            y: CANVAS_HEIGHT - 75,
            w: 36,
            h: 26
        };

        // colisão com power-up
        for (let i = powerUps.length - 1; i >= 0; i--) {
            const p = powerUps[i];
            const pupRect = { x: p.x - 16, y: p.y - 16, w: 32, h: 32 };
            if (rectCollide(playerRect, pupRect)) {
                powerUps.splice(i, 1);
                shieldActive = true;
                shieldCounter = SHIELD_DURATION;
                shieldSpan.innerText = '10.0';
                // alerta rápido de coleta
                alertBox.innerText = '🛡️ SHIELD ATIVO';
                setTimeout(() => { if (!videoHitWarning) alertBox.innerText = ''; }, 800);
            }
        }

        // colisão balas vs inimigos
        for (let i = bullets.length - 1; i >= 0; i--) {
            const b = bullets[i];
            for (let j = enemies.length - 1; j >= 0; j--) {
                const e = enemies[j];
                const enemyRect = { x: e.x - 22, y: e.y - 16, w: 44, h: 32 };
                const bulletRect = { x: b.x - 4, y: b.y - 8, w: 8, h: 16 };
                if (rectCollide(bulletRect, enemyRect)) {
                    // Destruir inimigo
                    let points = (e.type === 'text') ? CONFIG.pontos_texto : CONFIG.pontos_video;
                    if (shieldActive && e.type === 'video') points *= CONFIG.double_multiplier; // dobro
                    score += points;
                    enemies.splice(j, 1);
                    bullets.splice(i, 1);
                    break; // bullet sai
                }
            }
        }

        // colisão jogador com inimigo (evento principal)
        for (let i = enemies.length - 1; i >= 0; i--) {
            const e = enemies[i];
            const enemyRect = { x: e.x - 22, y: e.y - 16, w: 44, h: 32 };
            if (rectCollide(playerRect, enemyRect)) {
                // se for texto → destruir automático (mas não pontua, só some)
                if (e.type === 'text') {
                    enemies.splice(i, 1);
                    // texto some ao tocar, sem dano (River Raid estilo)
                    continue;
                }
                // VIDEO
                if (e.type === 'video') {
                    // Se shield ativo: destrói e pontua em dobro, sem dano
                    if (shieldActive) {
                        score += CONFIG.pontos_video * CONFIG.double_multiplier;
                        enemies.splice(i, 1);
                        continue;
                    }

                    // Sem shield: punição
                    enemies.splice(i, 1); // vídeo some ao colidir (1 erro)

                    if (!lastContactWasVideo) {
                        // primeiro erro em vídeo: perde 50% combustível e alerta
                        fuel = Math.max(0, fuel * 0.5);
                        videoHitWarning = true;
                        videoHitWarningFrames = 45; // 0.75s a 60fps
                        alertBox.innerText = CONFIG.alertas.primeiro_contato_video;
                        lastContactWasVideo = true;
                    } else {
                        // segundo erro seguido: explosão
                        gameOver = true;
                        exploded = true;
                        alertBox.innerText = CONFIG.alertas.segundo_contato_video + ' 💀';
                    }
                    // Atualiza HUD após perda de combustível
                }
            }
        }

        // reset do lastContactWasVideo se passar alguns frames sem colisão de video
        // (a cada 120 frames sem video hit, reset)
        if (frames % 120 === 0 && !lastContactWasVideo === false) {
            // não tão simples: vamos implementar timer próprio
        }
    }

    // timer separado para limpar flag de sequência (após ~2s sem contato de video)
    let noVideoFrames = 0;
    function resetLastContactIfNeeded() {
        if (lastContactWasVideo) {
            noVideoFrames++;
            if (noVideoFrames > 140) { // ~2.3s sem video hit
                lastContactWasVideo = false;
                noVideoFrames = 0;
            }
        } else {
            noVideoFrames = 0;
        }
    }

    function rectCollide(r1, r2) {
        return !(r2.x > r1.x + r1.w || r2.x + r2.w < r1.x ||
                 r2.y > r1.y + r1.h || r2.y + r2.h < r1.y);
    }

    // ---------- DESENHO ----------
    function drawBackground() {
        // rio de dados azul escuro com margens verdes (circuitos)
        ctx.fillStyle = '#0a1a2f';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        // margens laterais (circuitos)
        ctx.fillStyle = '#1b4a3b';
        ctx.fillRect(0, 0, 18, CANVAS_HEIGHT);
        ctx.fillRect(CANVAS_WIDTH-18, 0, 18, CANVAS_HEIGHT);
        // linhas de circuito
        ctx.strokeStyle = '#2f9e7a';
        ctx.lineWidth = 2;
        for (let i = 0; i < CANVAS_HEIGHT; i += 40) {
            ctx.beginPath();
            ctx.moveTo(8, (i + frames * 0.5) % CANVAS_HEIGHT);
            ctx.lineTo(18, (i + 10 + frames) % CANVAS_HEIGHT);
            ctx.strokeStyle = '#3fba90';
            ctx.stroke();
        }
        for (let i = 0; i < CANVAS_HEIGHT; i += 40) {
            ctx.beginPath();
            ctx.moveTo(CANVAS_WIDTH-8, (i + frames * 0.8) % CANVAS_HEIGHT);
            ctx.lineTo(CANVAS_WIDTH-18, (i + 20 + frames) % CANVAS_HEIGHT);
            ctx.stroke();
        }
    }

    function drawPlayer() {
        // Desenha o avião (ícone emissor)
        ctx.font = '34px "Segoe UI", "Arial Unicode MS", sans-serif';
        ctx.fillStyle = '#f0f9ff';
        ctx.fillText('✈️', playerX - 24, CANVAS_HEIGHT - 52);
        // sombra do avião
        ctx.shadowColor = '#0ff';
        ctx.shadowBlur = 12;
        ctx.fillText('✈️', playerX - 24, CANVAS_HEIGHT - 52);
        ctx.shadowBlur = 0;
    }

    function drawEnemies() {
        ctx.font = '28px "Segoe UI", "Arial Unicode MS", sans-serif';
        for (let e of enemies) {
            // cor baseada no tipo
            if (e.type === 'text') ctx.fillStyle = '#7ef0ba'; // verde/azul
            else ctx.fillStyle = '#ff8866'; // laranja/vermelho

            ctx.shadowBlur = 14;
            ctx.shadowColor = e.type === 'text' ? '#0ff' : '#f44';
            ctx.fillText(e.icon, e.x - 22, e.y - 4);
            // nome
            ctx.font = 'bold 18px "Courier New", monospace';
            ctx.fillStyle = 'white';
            ctx.shadowBlur = 8;
            ctx.shadowColor = '#000';
            ctx.fillText(e.name, e.x - 20, e.y - 24);
        }
        ctx.shadowBlur = 0;
    }

    function drawBullets() {
        ctx.fillStyle = '#fcee8f';
        ctx.shadowBlur = 14;
        ctx.shadowColor = '#fcffb0';
        for (let b of bullets) {
            ctx.beginPath();
            ctx.moveTo(b.x, b.y);
            ctx.lineTo(b.x - 4, b.y - 14);
            ctx.lineTo(b.x + 4, b.y - 14);
            ctx.closePath();
            ctx.fillStyle = '#ffe066';
            ctx.fill();
        }
        ctx.shadowBlur = 0;
    }

    function drawPowerUps() {
        ctx.font = '34px sans-serif';
        ctx.fillStyle = '#ffde7a';
        ctx.shadowBlur = 20;
        ctx.shadowColor = '#f0b300';
        for (let p of powerUps) {
            ctx.fillText('💡', p.x - 20, p.y);
        }
        ctx.shadowBlur = 0;
    }

    function drawHUD() {
        fuelSpan.innerText = Math.floor(fuel);
        scoreSpan.innerText = score;
        if (gameOver) {
            ctx.font = 'bold 48px monospace';
            ctx.fillStyle = '#ff0000aa';
            ctx.shadowBlur = 22;
            ctx.fillText('GAME OVER', 100, 300);
        }
    }

    // ---------- LOOP PRINCIPAL ----------
    function gameLoop() {
        if (!gameOver) {
            frames++;

            // spawn
            if (frames % CONFIG.spawn_intervalo_frames === 0) spawnEnemy();
            spawnPowerUp();

            updateMovement();
            handleCollisions();
            resetLastContactIfNeeded();

            // atualiza alerta se necessário
            if (videoHitWarning && videoHitWarningFrames > 0) {
                // já tem texto
            } else if (!videoHitWarning && !gameOver) alertBox.innerText = '';
        }

        // desenho
        drawBackground();
        drawPowerUps();
        drawEnemies();
        drawBullets();
        drawPlayer();
        drawHUD();

        requestAnimationFrame(gameLoop);
    }
})();