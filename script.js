// script.js — AI RAID EVOLUTION (3 fases + áudio sintetizado)
// Tudo inline, sem assets externos, Web Audio API para sons

(() => {
    // ---------- CONFIGURATIONS (INLINE DO JSON) ----------
    const CONFIG = {
        game_config: {
            total_levels: 3,
            win_score_per_level: 3000
        },
        audio_settings: {
            enabled: true,
            volume: 0.25
        },
        levels: [
            { id: 1, name: "LEVEL 1: TEXT ERA", instruction: "DESTROY TEXT LLMs ONLY! (Avoid Video)", target_type: "TEXT", penalty_type: "VIDEO", background_speed: 3 },
            { id: 2, name: "LEVEL 2: VIDEO REVOLUTION", instruction: "SWITCH! DESTROY VIDEO IAs! (Avoid Text)", target_type: "VIDEO", penalty_type: "TEXT", background_speed: 5 },
            { id: 3, name: "LEVEL 3: FINAL BOSS", instruction: "DESTROY THE GIANT BUG!", target_type: "BOSS", boss_hp: 50, background_speed: 8 }
        ],
        entities: {
            TEXT: { names: ["GPT", "Gemini", "Claude", "Llama"], color: "#00FFCC", icon: "💬" },
            VIDEO: { names: ["Sora", "Runway", "Kling", "Luma"], color: "#FF4444", icon: "🎬" },
            BOSS: { name: "THE GLITCH", color: "#AA00FF", icon: "👾" }
        },
        player: {
            fuel: 100,
            fuel_loss_wrong_target: 10
        }
    };

    // ---------- GLOBAL STATE ----------
    const CANVAS_WIDTH = 600, CANVAS_HEIGHT = 600;
    let canvas, ctx;
    let gameOver = false;
    let gameWin = false;
    let frames = 0;
    let score = 0;
    let fuel = CONFIG.player.fuel;
    let playerX = CANVAS_WIDTH/2;

    // level system
    let currentLevel = 0;          // 0,1,2 (index)
    let levelScore = 0;            // pontos acumulados na fase atual
    let transition = false;
    let transitionTimer = 0;
    let nextLevelIndex = 1;

    // inimigos, balas, powerups
    let enemies = [];
    let bullets = [];
    let powerUps = [];    // shield continua igual

    // boss específico
    let boss = null;      // { x, y, hp, w, h }

    // shield (herdado)
    let shieldActive = false;
    let shieldCounter = 0;
    const SHIELD_DURATION = 600;

    // avisos de penalidade
    let lastContactWasPenalty = false;  // sequência para 2° erro (perde 50% e depois explode)
    let noPenaltyFrames = 0;
    let warningMessage = '';
    let warningFrames = 0;

    // input
    let keys = { left: false, right: false, space: false };
    let canShoot = true;
    let shotCooldown = 0;
    const SHOT_COOLDOWN = 10;

    // áudio
    let audioCtx = null;
    let soundManager = null;

    // elementos DOM
    const fuelSpan = document.getElementById('fuelValue');
    const scoreSpan = document.getElementById('scoreValue');
    const shieldSpan = document.getElementById('shieldTimer');
    const levelDisplay = document.getElementById('levelDisplay');
    const instructionBox = document.getElementById('instructionBox');
    const transitionOverlay = document.getElementById('transitionOverlay');
    const transitionMessage = document.getElementById('transitionMessage');
    const bossHpContainer = document.getElementById('bossHpContainer');
    const bossHpSpan = document.getElementById('bossHpValue');

    // ---------- SOUND MANAGER (Web Audio API, sem arquivos) ----------
    class SoundManager {
        constructor() {
            this.context = null;
            this.enabled = CONFIG.audio_settings.enabled;
            this.volume = CONFIG.audio_settings.volume;
        }

        init() {
            if (!this.enabled) return;
            if (this.context) return;
            try {
                this.context = new (window.AudioContext || window.webkitAudioContext)();
                // Desbloqueio em interação do usuário (já vai ter clique)
            } catch(e) { console.warn("Web Audio não suportada"); }
        }

        playShoot() {
            if (!this.enabled || !this.context) return;
            if (this.context.state === 'suspended') this.context.resume();
            const now = this.context.currentTime;
            const osc = this.context.createOscillator();
            const gain = this.context.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(880, now);
            osc.frequency.exponentialRampToValueAtTime(220, now + 0.08);
            gain.gain.setValueAtTime(this.volume * 0.3, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
            osc.connect(gain).connect(this.context.destination);
            osc.start(now);
            osc.stop(now + 0.15);
        }

        playExplosion() {
            if (!this.enabled || !this.context) return;
            if (this.context.state === 'suspended') this.context.resume();
            const now = this.context.currentTime;
            // Ruído branco simples via buffer
            const bufferSize = 4096;
            const buffer = this.context.createBuffer(1, bufferSize, this.context.sampleRate);
            const output = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                output[i] = Math.random() * 2 - 1;
            }
            const whiteNoise = this.context.createBufferSource();
            whiteNoise.buffer = buffer;
            const gainNode = this.context.createGain();
            gainNode.gain.setValueAtTime(this.volume * 0.4, now);
            gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
            whiteNoise.connect(gainNode).connect(this.context.destination);
            whiteNoise.start(now);
            whiteNoise.stop(now + 0.4);
        }

        playLevelUp() {
            if (!this.enabled || !this.context) return;
            if (this.context.state === 'suspended') this.context.resume();
            const now = this.context.currentTime;
            // sequência sine: Dó, Mi, Sol
            [523.25, 659.25, 783.99].forEach((freq, i) => {
                const osc = this.context.createOscillator();
                const gain = this.context.createGain();
                osc.type = 'sine';
                osc.frequency.value = freq;
                gain.gain.setValueAtTime(this.volume * 0.2, now + i * 0.1);
                gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.2);
                osc.connect(gain).connect(this.context.destination);
                osc.start(now + i * 0.1);
                osc.stop(now + i * 0.1 + 0.2);
            });
        }

        playCollect() {
            if (!this.enabled || !this.context) return;
            if (this.context.state === 'suspended') this.context.resume();
            const now = this.context.currentTime;
            const osc = this.context.createOscillator();
            const gain = this.context.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, now);
            osc.frequency.exponentialRampToValueAtTime(1760, now + 0.1);
            gain.gain.setValueAtTime(this.volume * 0.15, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
            osc.connect(gain).connect(this.context.destination);
            osc.start(now);
            osc.stop(now + 0.2);
        }
    }

    // ---------- INICIALIZAÇÃO ----------
    window.addEventListener('load', () => {
        canvas = document.getElementById('gameCanvas');
        ctx = canvas.getContext('2d');
        soundManager = new SoundManager();
        soundManager.init();

        // inicia nível 1
        startLevel(0);
        requestAnimationFrame(gameLoop);
    });

    function startLevel(levelIndex) {
        currentLevel = levelIndex;
        const lvl = CONFIG.levels[levelIndex];
        levelDisplay.innerText = lvl.name;
        instructionBox.innerText = lvl.instruction;

        // limpa entidades
        enemies = [];
        bullets = [];
        boss = null;

        if (levelIndex === 2) { // boss
            boss = {
                x: 300, y: 80,
                hp: CONFIG.levels[2].boss_hp,
                w: 70, h: 60,
                direction: 1
            };
            bossHpContainer.style.display = 'block';
            bossHpSpan.innerText = boss.hp;
        } else {
            bossHpContainer.style.display = 'none';
        }

        // reseta levelScore (mas mantem score total)
        levelScore = 0;

        // pequeno reset de flags
        lastContactWasPenalty = false;
        warningFrames = 0;
        warningMessage = '';
    }

    function advanceToNextLevel() {
        if (currentLevel + 1 >= CONFIG.game_config.total_levels) {
            // vitória final
            gameWin = true;
            gameOver = true; // para parar a ação
            instructionBox.innerText = 'VITÓRIA! VOCÊ VENCEU O GLITCH!';
            return;
        }
        // transição para o próximo nível
        transition = true;
        transitionTimer = 120; // 2 segundos (60fps)
        nextLevelIndex = currentLevel + 1;
        transitionMessage.innerText = `FASE ${nextLevelIndex+1} · ${CONFIG.levels[nextLevelIndex].name}`;
        transitionOverlay.classList.remove('hidden');
        soundManager.playLevelUp();
    }

    // ---------- SPAWN (respeita fase) ----------
    function spawnEnemyByLevel() {
        if (currentLevel === 2) return; // boss não spawna normais

        const isText = Math.random() < 0.5; // 50/50
        let type = isText ? 'TEXT' : 'VIDEO';
        let icon = isText ? CONFIG.entities.TEXT.icon : CONFIG.entities.VIDEO.icon;
        let name = isText 
            ? CONFIG.entities.TEXT.names[Math.floor(Math.random() * CONFIG.entities.TEXT.names.length)]
            : CONFIG.entities.VIDEO.names[Math.floor(Math.random() * CONFIG.entities.VIDEO.names.length)];

        enemies.push({
            type: type,
            name: name,
            icon: icon,
            x: 40 + Math.random() * (CANVAS_WIDTH - 100),
            y: -40,
            w: 44, h: 34
        });
    }

    // ---------- ATUALIZAÇÃO -------------
    function updateGame() {
        if (gameOver || gameWin || transition) return;

        frames++;
        const level = CONFIG.levels[currentLevel];

        // spawn rate
        if (currentLevel < 2 && frames % 28 === 0) spawnEnemyByLevel();

        // movimento do boss (level 3)
        if (boss) {
            boss.x += boss.direction * 2.2;
            if (boss.x < 80 || boss.x > 520) boss.direction *= -1;
        }

        // movimento do jogador
        const MOVE = 5.2;
        if (keys.left) playerX = Math.max(22, playerX - MOVE);
        if (keys.right) playerX = Math.min(CANVAS_WIDTH - 22, playerX + MOVE);

        // tiros
        if (keys.space && canShoot) {
            bullets.push({ x: playerX, y: CANVAS_HEIGHT - 70 });
            canShoot = false;
            shotCooldown = SHOT_COOLDOWN;
            soundManager.playShoot();
        }
        if (!canShoot) {
            shotCooldown--;
            if (shotCooldown <= 0) canShoot = true;
        }

        // scroll inimigos
        const spd = level.background_speed;
        for (let i = enemies.length-1; i>=0; i--) {
            enemies[i].y += spd;
            if (enemies[i].y > CANVAS_HEIGHT + 50) enemies.splice(i,1);
        }
        // power-ups (igual)
        for (let i = powerUps.length-1; i>=0; i--) {
            powerUps[i].y += spd;
            if (powerUps[i].y > CANVAS_HEIGHT + 50) powerUps.splice(i,1);
        }
        // balas
        for (let i = bullets.length-1; i>=0; i--) {
            bullets[i].y -= 7;
            if (bullets[i].y < -20) bullets.splice(i,1);
        }

        // combustível
        fuel = Math.max(0, fuel - 0.12);
        if (fuel <= 0) { gameOver = true; instructionBox.innerText = 'GAME OVER · SEM COMBUSTÍVEL'; }

        // shield
        if (shieldActive) {
            shieldCounter--;
            shieldSpan.innerText = (shieldCounter/60).toFixed(1);
            if (shieldCounter <= 0) { shieldActive = false; shieldSpan.innerText = '0'; }
        }

        // colisões: balas vs inimigos
        for (let i = bullets.length-1; i>=0; i--) {
            const b = bullets[i];
            for (let j = enemies.length-1; j>=0; j--) {
                const e = enemies[j];
                if (rectCollide({x:b.x-4, y:b.y-8, w:8, h:16}, {x:e.x-22, y:e.y-16, w:44, h:32})) {
                    // acertou inimigo
                    const targetIsValid = (level.target_type === e.type);
                    const targetIsPenalty = (level.penalty_type === e.type);

                    if (targetIsValid || (shieldActive && currentLevel < 2)) { // shield permite qualquer destruição em fases 1/2
                        score += 100;
                        levelScore += 100;
                        enemies.splice(j,1);
                        bullets.splice(i,1);
                        soundManager.playExplosion(); // pequeno
                    } 
                    else if (targetIsPenalty && !shieldActive) {
                        // atirou no proibido: perde combustível
                        fuel = Math.max(0, fuel - CONFIG.player.fuel_loss_wrong_target);
                        enemies.splice(j,1);
                        bullets.splice(i,1);
                        warningMessage = 'PENALIDADE!';
                        warningFrames = 30;
                        soundManager.playExplosion();
                        // verifica sequência de erro? (aqui só perde combustível avulso)
                    } else {
                        // neutral, só deleta bala
                        bullets.splice(i,1);
                    }
                    break;
                }
            }
        }

        // colisão jogador com inimigo (bateu)
        const playerRect = {x: playerX-18, y: CANVAS_HEIGHT-75, w:36, h:26};
        for (let i = enemies.length-1; i>=0; i--) {
            const e = enemies[i];
            if (rectCollide(playerRect, {x:e.x-22, y:e.y-16, w:44, h:32})) {
                if (shieldActive) {
                    enemies.splice(i,1);
                    soundManager.playExplosion();
                    continue;
                }
                // tratamento padrão: perde 50% se for a primeira colisão com penalidade
                if (e.type === CONFIG.levels[currentLevel].penalty_type || currentLevel===2) { // tudo no boss?
                    if (!lastContactWasPenalty) {
                        fuel *= 0.5;
                        lastContactWasPenalty = true;
                        warningMessage = '⚠️ 50% FUEL';
                        warningFrames = 50;
                    } else {
                        gameOver = true;
                        instructionBox.innerText = 'EXPLOSÃO · 2º ERRO';
                        soundManager.playExplosion();
                    }
                }
                enemies.splice(i,1);
            }
        }

        // reset lastContactWasPenalty
        if (lastContactWasPenalty) {
            noPenaltyFrames++;
            if (noPenaltyFrames > 150) { lastContactWasPenalty = false; noPenaltyFrames=0; }
        } else noPenaltyFrames = 0;

        // colisão com power-up shield
        for (let i = powerUps.length-1; i>=0; i--) {
            const p = powerUps[i];
            if (rectCollide(playerRect, {x:p.x-16, y:p.y-16, w:32, h:32})) {
                powerUps.splice(i,1);
                shieldActive = true;
                shieldCounter = SHIELD_DURATION;
                shieldSpan.innerText = '10.0';
                soundManager.playCollect();
            }
        }

        // verifica progressão de fase
        if (currentLevel < 2 && levelScore >= CONFIG.game_config.win_score_per_level) {
            advanceToNextLevel();
        }

        // boss fight (level 3) - colisão de balas com boss
        if (boss) {
            for (let i = bullets.length-1; i>=0; i--) {
                const b = bullets[i];
                if (rectCollide({x:b.x-4,y:b.y-8,w:8,h:16}, {x:boss.x-35, y:boss.y-30, w:70, h:60})) {
                    boss.hp -= 1;
                    bullets.splice(i,1);
                    soundManager.playExplosion();
                    bossHpSpan.innerText = boss.hp;
                    if (boss.hp <= 0) {
                        gameWin = true;
                        gameOver = true;
                        instructionBox.innerText = 'BOSS DESTRUÍDO · VITÓRIA!';
                    }
                    break;
                }
            }
        }
    }

    function rectCollide(r1, r2) {
        return !(r2.x > r1.x + r1.w || r2.x + r2.w < r1.x || r2.y > r1.y + r1.h || r2.y + r2.h < r1.y);
    }

    // transição
    function updateTransition() {
        if (!transition) return;
        transitionTimer--;
        if (transitionTimer <= 0) {
            transition = false;
            transitionOverlay.classList.add('hidden');
            startLevel(nextLevelIndex);
        }
    }

    // ---------- DESENHO ----------
    function draw() {
        // fundo
        ctx.fillStyle = '#0a1a2f';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        // margens verdes
        ctx.fillStyle = '#1b4a3b';
        ctx.fillRect(0, 0, 16, CANVAS_HEIGHT);
        ctx.fillRect(CANVAS_WIDTH-16, 0, 16, CANVAS_HEIGHT);

        // power-ups
        ctx.font = '36px sans-serif';
        ctx.fillStyle = '#ffde7a';
        powerUps.forEach(p => ctx.fillText('💡', p.x-20, p.y));

        // inimigos
        enemies.forEach(e => {
            ctx.font = '28px "Segoe UI"';
            ctx.fillStyle = e.type === 'TEXT' ? CONFIG.entities.TEXT.color : CONFIG.entities.VIDEO.color;
            ctx.fillText(e.icon, e.x-22, e.y-4);
            ctx.font = 'bold 16px monospace';
            ctx.fillStyle = 'white';
            ctx.fillText(e.name, e.x-20, e.y-26);
        });

        // boss
        if (boss) {
            ctx.font = '80px sans-serif';
            ctx.fillStyle = CONFIG.entities.BOSS.color;
            ctx.fillText('👾', boss.x-50, boss.y);
            ctx.font = '20px monospace';
            ctx.fillStyle = 'white';
            ctx.fillText(`HP ${boss.hp}`, boss.x-32, boss.y-45);
        }

        // balas
        ctx.fillStyle = '#fcee8f';
        bullets.forEach(b => {
            ctx.beginPath();
            ctx.moveTo(b.x, b.y);
            ctx.lineTo(b.x-4, b.y-14);
            ctx.lineTo(b.x+4, b.y-14);
            ctx.fill();
        });

        // jogador
        ctx.font = '38px sans-serif';
        ctx.fillStyle = '#e0f2ff';
        ctx.fillText('✈️', playerX-24, CANVAS_HEIGHT-52);
        ctx.shadowBlur = 16; ctx.shadowColor = '#0ff';
        ctx.fillText('✈️', playerX-24, CANVAS_HEIGHT-52);
        ctx.shadowBlur = 0;

        // HUD
        fuelSpan.innerText = Math.floor(fuel);
        scoreSpan.innerText = score;
        if (warningFrames-- > 0) {
            ctx.font = 'bold 32px monospace';
            ctx.fillStyle = '#ff4444';
            ctx.fillText(warningMessage, 200, 200);
        }
    }

    function gameLoop() {
        if (!transition && !gameOver && !gameWin) updateGame();
        else updateTransition();
        draw();
        requestAnimationFrame(gameLoop);
    }

    // ---------- EVENTOS ----------
    window.addEventListener('keydown', (e) => {
        if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); keys.space = true; }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); keys.left = true; }
        else if (e.key === 'ArrowRight') { e.preventDefault(); keys.right = true; }
    });
    window.addEventListener('keyup', (e) => {
        if (e.key === ' ' || e.code === 'Space') { keys.space = false; }
        else if (e.key === 'ArrowLeft') { keys.left = false; }
        else if (e.key === 'ArrowRight') { keys.right = false; }
    });
    // inicia áudio no primeiro clique (desbloqueio)
    document.body.addEventListener('click', () => {
        if (soundManager && soundManager.context && soundManager.context.state === 'suspended')
            soundManager.context.resume();
    }, { once: true });
})();
