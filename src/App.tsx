import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Ghost, Zap, Trophy, SkipForward, RefreshCw, Play, Pause, AlertTriangle, Settings, User, Plus, Trash2, Volume2, VolumeX, Edit, Clock, Shield, Sparkles, BrainCircuit, Upload, LogOut, Maximize2, Minimize2 } from 'lucide-react';
import confetti from 'canvas-confetti';
import { QUESTIONS as DEFAULT_QUESTIONS, MAZE_GRID } from './constants';
import { GoogleGenAI, Type } from "@google/genai";

// --- Types ---
type Position = { x: number; y: number };
type Player = {
  id: 1 | 2;
  pos: Position;
  score: number;
  color: string;
  stunTimer: number;
  speedBoostTimer: number;
  direction: Position; // Current movement direction
  nextDirection: Position; // Queued direction
  trail: Position[]; // Trail history
  avatar: string; // Emoji avatar
  isMoving: boolean; // For animation
  stepTimer?: number; // For sound
  streak: number; // Combo streak
  hasShield: boolean; // Shield status
};
type Entity = { 
  pos: Position; 
  type: 'ghost' | 'powerup' | 'answer' | 'bonus' | 'freeze' | 'shield'; 
  value?: string;
  behavior?: 'wander' | 'chase' | 'flee'; // For enemies
  visual?: string; // Emoji for enemies
  guardPos?: Position; // Position to guard
  fleeTimer?: number; // Time to flee from player
};

type Question = {
  question: string;
  options: { A: string; B: string; C: string; D: string };
  correct: string;
  subject: string;
};

const TILE_SIZE = 40; // Base tile size, will scale
const PLAYER_SPEED = 5; // Tiles per second
const GHOST_SPEED = 2.5; // Tiles per second
const BOOST_MULTIPLIER = 2;
const TRAIL_LENGTH = 10;

const AVATARS = ['👦', '👧', '🐶', '🐱', '🦊', '🦁', '🐸', '🤖', '👽', '🦄', '🐲', '🐼', '🐯', '🐨', '🐵', '🦉'];
const ENEMY_VISUALS = {
  wander: ['👾', '🦠', '🐌', '🐛'],
  chase: ['👹', '👺', '🦈', '🦖']
};

// --- Sound Manager ---
class SoundManager {
  ctx: AudioContext | null = null;
  bgmOscillators: OscillatorNode[] = [];
  isMuted: boolean = false;
  typingInterval: number | null = null;

  constructor() {
    try {
      // @ts-ignore
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioContext();
    } catch (e) {
      console.error("AudioContext not supported");
    }
  }

  resume() {
    if (this.ctx?.state === 'suspended') {
      this.ctx.resume();
    }
  }

  playTone(freq: number, type: OscillatorType, duration: number, vol: number = 0.1) {
    if (this.isMuted || !this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
    gain.gain.setValueAtTime(vol, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + duration);
  }

  playMove() {
    // Subtle "bloop"
    this.playTone(200 + Math.random() * 50, 'sine', 0.1, 0.05);
  }

  playStepP1() {
    // Low pitch "bloop" for Player 1
    this.playTone(150, 'sine', 0.1, 0.1);
  }

  playStepP2() {
    // High pitch "tick" for Player 2
    this.playTone(400, 'triangle', 0.05, 0.05);
  }

  playTyping() {
    if (this.isMuted || !this.ctx || this.typingInterval) return;
    // @ts-ignore
    this.typingInterval = setInterval(() => {
        if (this.isMuted) return;
        // Futuristic typing blips
        this.playTone(800 + Math.random() * 600, 'square', 0.03, 0.05);
    }, 80);
  }

  stopTyping() {
    if (this.typingInterval) {
        clearInterval(this.typingInterval);
        this.typingInterval = null;
    }
  }

  playCorrect() {
    if (this.isMuted || !this.ctx) return;
    const now = this.ctx.currentTime;
    [440, 554, 659, 880].forEach((freq, i) => { // A Major Arpeggio
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, now + i * 0.1);
      gain.gain.setValueAtTime(0.1, now + i * 0.1);
      gain.gain.linearRampToValueAtTime(0, now + i * 0.1 + 0.2);
      osc.connect(gain);
      gain.connect(this.ctx!.destination);
      osc.start(now + i * 0.1);
      osc.stop(now + i * 0.1 + 0.2);
    });
  }

  playWrong() {
    if (this.isMuted || !this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, this.ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(50, this.ctx.currentTime + 0.3);
    gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.3);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.3);
  }

  playPowerup() {
    if (this.isMuted || !this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(400, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1200, this.ctx.currentTime + 0.4);
    gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.4);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.4);
  }

  playDamage() {
    this.playTone(100, 'sawtooth', 0.2, 0.2);
  }

  playFreeze() {
    if (this.isMuted || !this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, this.ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(200, this.ctx.currentTime + 0.5);
    gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.5);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.5);
  }

  playShieldPickup() {
    this.playTone(600, 'sine', 0.1, 0.1);
    setTimeout(() => this.playTone(800, 'sine', 0.2, 0.1), 100);
  }

  playShieldBreak() {
    this.playTone(150, 'sawtooth', 0.3, 0.2);
    setTimeout(() => this.playTone(100, 'sawtooth', 0.3, 0.1), 100);
  }

  playVoice(text: string) {
    if (this.isMuted) return;
    // Cancel any ongoing speech to avoid overlap
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'id-ID';
    utterance.rate = 1.2;
    utterance.pitch = 1.0;
    window.speechSynthesis.speak(utterance);
  }
}

const soundManager = new SoundManager();

// --- Helper Functions ---
const checkCollision = (p1: Position, p2: Position, radius: number = 0.5) => {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.sqrt(dx * dx + dy * dy) < radius;
};

const getValidSpawn = (grid: number[][]) => {
  let x, y;
  do {
    x = Math.floor(Math.random() * grid[0].length);
    y = Math.floor(Math.random() * grid.length);
  } while (grid[y][x] === 1);
  return { x, y };
};

export default function App() {
  const [gameState, setGameState] = useState<'splash' | 'setup' | 'editor' | 'playing' | 'finished'>('splash');
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [scores, setScores] = useState({ p1: 0, p2: 0 });
  const [winner, setWinner] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [shake, setShake] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [timeLeft, setTimeLeft] = useState(60);
  const [isWaitingForNextRound, setIsWaitingForNextRound] = useState(false);
  const [preRoundCountdown, setPreRoundCountdown] = useState<number | null>(null);

  // Setup State
  const [p1Avatar, setP1Avatar] = useState(AVATARS[2]); // Dog
  const [p2Avatar, setP2Avatar] = useState(AVATARS[3]); // Cat
  const [p1Name, setP1Name] = useState('Player 1');
  const [p2Name, setP2Name] = useState('Player 2');
  const [customLogo, setCustomLogo] = useState<string | null>(null);
  const [enemyCount, setEnemyCount] = useState(5);
  const [enemySpeed, setEnemySpeed] = useState(2.5);
  const [questionTimeLimit, setQuestionTimeLimit] = useState(60);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable full-screen mode: ${err.message}`);
      });
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);
  const [aiTopic, setAiTopic] = useState('');
  const [aiQuestionCount, setAiQuestionCount] = useState(10);
  const [customApiKey, setCustomApiKey] = useState(() => localStorage.getItem('gemini_api_key') || '');
  
  // Custom Questions State
  const [questions, setQuestions] = useState<Question[]>(DEFAULT_QUESTIONS);
  const [editingQuestion, setEditingQuestion] = useState<Partial<Question>>({
    question: '',
    options: { A: '', B: '', C: '', D: '' },
    correct: 'A',
    subject: 'Umum'
  });

  // --- AI Question Generation ---
  const generateQuestions = async () => {
    const apiKey = process.env.GEMINI_API_KEY || customApiKey;
    
    if (!apiKey) {
      setFeedback({ msg: "API Key tidak ditemukan! Masukkan API Key di Editor Soal.", type: "error" });
      setTimeout(() => setFeedback(null), 3000);
      return;
    }
    
    setIsGenerating(true);
    soundManager.playTyping();
    try {
      const ai = new GoogleGenAI({ apiKey });
      const topic = aiTopic.trim() || "Pengetahuan Umum SD";
      
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Buatlah ${aiQuestionCount} soal pilihan ganda untuk anak SD tentang "${topic}" dalam Bahasa Indonesia.
        Format JSON array of objects:
        [
          {
            "question": "Pertanyaan...",
            "options": { "A": "...", "B": "...", "C": "...", "D": "..." },
            "correct": "A", // atau B/C/D
            "subject": "${topic}"
          }
        ]`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                question: { type: Type.STRING },
                options: {
                  type: Type.OBJECT,
                  properties: {
                    A: { type: Type.STRING },
                    B: { type: Type.STRING },
                    C: { type: Type.STRING },
                    D: { type: Type.STRING }
                  },
                  required: ["A", "B", "C", "D"]
                },
                correct: { type: Type.STRING },
                subject: { type: Type.STRING }
              },
              required: ["question", "options", "correct", "subject"]
            }
          }
        }
      });

      const text = response.text;
      if (text) {
        const newQuestions = JSON.parse(text);
        if (Array.isArray(newQuestions) && newQuestions.length > 0) {
          setQuestions(prev => [...prev, ...newQuestions]);
          setFeedback({ msg: `Berhasil menambahkan ${newQuestions.length} soal baru!`, type: "success" });
          setTimeout(() => setFeedback(null), 3000);
        }
      }
    } catch (error) {
      console.error("AI Error:", error);
      setFeedback({ msg: "Gagal membuat soal AI. Coba lagi.", type: "error" });
    } finally {
      setIsGenerating(false);
      soundManager.stopTyping();
    }
  };

  // Refs for game loop to avoid re-renders
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<number>(null);
  const gridRef = useRef(MAZE_GRID);
  const questionTimerRef = useRef(60);
  const enemiesFrozenTimerRef = useRef(0);
  const lastTimeRef = useRef<number>(0);
  
  // Game State Refs
  const playersRef = useRef<Player[]>([
    { id: 1, pos: { x: 1, y: 1 }, score: 0, color: '#3b82f6', stunTimer: 0, speedBoostTimer: 0, direction: { x: 0, y: 0 }, nextDirection: { x: 0, y: 0 }, trail: [], avatar: AVATARS[2], isMoving: false, streak: 0 },
    { id: 2, pos: { x: 19, y: 13 }, score: 0, color: '#ef4444', stunTimer: 0, speedBoostTimer: 0, direction: { x: 0, y: 0 }, nextDirection: { x: 0, y: 0 }, trail: [], avatar: AVATARS[3], isMoving: false, streak: 0 }
  ]);
  const ghostsRef = useRef<Entity[]>([]);
  const powerupsRef = useRef<Entity[]>([]);
  const answersRef = useRef<Entity[]>([]);
  const inputState = useRef<{ [key: string]: boolean }>({});
  
  // --- Initialization ---
  const startGame = () => {
    soundManager.resume();
    setGameState('playing');
    lastTimeRef.current = performance.now();
    setScores({ p1: 0, p2: 0 });
    setCurrentQuestionIndex(0);
    setWinner(null);
    
    // Reset Players
    playersRef.current = [
      { id: 1, pos: { x: 1, y: 1 }, score: 0, color: '#3b82f6', stunTimer: 0, speedBoostTimer: 0, direction: { x: 0, y: 0 }, nextDirection: { x: 0, y: 0 }, trail: [], avatar: p1Avatar, isMoving: false, streak: 0, hasShield: false },
      { id: 2, pos: { x: 19, y: 13 }, score: 0, color: '#ef4444', stunTimer: 0, speedBoostTimer: 0, direction: { x: 0, y: 0 }, nextDirection: { x: 0, y: 0 }, trail: [], avatar: p2Avatar, isMoving: false, streak: 0, hasShield: false }
    ];

    // Powerups & Round Setup
    powerupsRef.current = [];
    setupRound(0);
  };

  const setupRound = (qIndex: number) => {
    questionTimerRef.current = questionTimeLimit;
    setTimeLeft(questionTimeLimit);
    
    // Spawn Answers (A, B, C, D)
    const options = ['A', 'B', 'C', 'D'];
    const newAnswers: Entity[] = [];
    
    // Divide grid into 4 quadrants to ensure spread
    const gridW = gridRef.current[0].length;
    const gridH = gridRef.current.length;
    const midX = Math.floor(gridW / 2);
    const midY = Math.floor(gridH / 2);
    
    const quadrants = [
      { xMin: 0, xMax: midX, yMin: 0, yMax: midY }, // Top-Left
      { xMin: midX, xMax: gridW, yMin: 0, yMax: midY }, // Top-Right
      { xMin: 0, xMax: midX, yMin: midY, yMax: gridH }, // Bottom-Left
      { xMin: midX, xMax: gridW, yMin: midY, yMax: gridH } // Bottom-Right
    ];
    
    // Helper to find valid spot in bounds
    const getSpawnInBounds = (bounds: {xMin: number, xMax: number, yMin: number, yMax: number}) => {
       let x, y;
       let attempts = 0;
       do {
         x = Math.floor(Math.random() * (bounds.xMax - bounds.xMin)) + bounds.xMin;
         y = Math.floor(Math.random() * (bounds.yMax - bounds.yMin)) + bounds.yMin;
         attempts++;
       } while ((gridRef.current[y]?.[x] === 1 || (x===1 && y===1) || (x===19 && y===13)) && attempts < 50);
       
       if (attempts >= 50) return getValidSpawn(gridRef.current); // Fallback
       return { x, y };
    };

    // Shuffle quadrants assignment to randomize which letter goes where
    const shuffledQuadrants = [...quadrants].sort(() => Math.random() - 0.5);

    options.forEach((opt, i) => {
       const pos = getSpawnInBounds(shuffledQuadrants[i % 4]);
       newAnswers.push({ pos, type: 'answer', value: opt });
    });
    
    answersRef.current = newAnswers;

    // --- Spawn Enemies (Logic Update) ---
    // <= 8 enemies: 1 chaser
    // > 8 enemies: 3 chasers
    let numChasers = 0;
    if (enemyCount > 8) numChasers = 3;
    else if (enemyCount > 0) numChasers = 1;
    
    const newGhosts: Entity[] = [];
    
    // Spawn Chasers (Guard Answers)
    for (let i = 0; i < numChasers; i++) {
       // Assign to guard a specific answer
       // If we have more chasers than answers (unlikely with max 3), loop around
       const targetAnswer = newAnswers[i % newAnswers.length];
       
       // Spawn NEAR the answer (not on top to avoid instant collision if player is there, though players are usually far)
       // We'll spawn them exactly at the answer location for now, they will guard it.
       // Or better, find a valid neighbor.
       let spawnPos = { ...targetAnswer.pos };
       
       newGhosts.push({
         pos: spawnPos,
         type: 'ghost',
         behavior: 'chase',
         visual: ENEMY_VISUALS.chase[i % ENEMY_VISUALS.chase.length],
         guardPos: { ...targetAnswer.pos } // Guard this spot
       });
    }

    // Spawn Wanderers (Random)
    const numWanderers = Math.max(0, enemyCount - numChasers);
    for (let i = 0; i < numWanderers; i++) {
       newGhosts.push({
         pos: getValidSpawn(gridRef.current),
         type: 'ghost',
         behavior: 'wander',
         visual: ENEMY_VISUALS.wander[Math.floor(Math.random() * ENEMY_VISUALS.wander.length)]
       });
    }
    
    ghostsRef.current = newGhosts;
    
    // Spawn Powerups (Boosts, Freeze, Shield)
    const numPowerups = 2 + Math.floor(Math.random() * 3);
    for(let i=0; i<numPowerups; i++) {
        const rand = Math.random();
        let type: 'powerup' | 'freeze' | 'shield' = 'powerup';
        if (rand > 0.8) type = 'shield'; // 20% chance
        else if (rand > 0.5) type = 'freeze'; // 30% chance
        
        powerupsRef.current.push({ pos: getValidSpawn(gridRef.current), type });
    }

    // Spawn Bonus Points (1-3 pts)
    const numBonuses = 3 + Math.floor(Math.random() * 3); // 3 to 5 bonuses
    for(let i=0; i<numBonuses; i++) {
        const val = 1 + Math.floor(Math.random() * 3); // 1, 2, or 3
        powerupsRef.current.push({ 
            pos: getValidSpawn(gridRef.current), 
            type: 'bonus', // Re-using powerups array for collectables to simplify, or separate? 
                           // Let's separate or use a generic 'items' array. 
                           // For minimal code change, I'll put them in powerupsRef but distinguish by type.
            value: val.toString()
        });
    }
  };

  // --- Game Loop ---
  const update = (time: number) => {
    if (gameState !== 'playing' || isWaitingForNextRound || preRoundCountdown !== null) {
      lastTimeRef.current = time;
      requestRef.current = requestAnimationFrame(update);
      return;
    }

    const dt = Math.min((time - lastTimeRef.current) / 1000, 0.1);
    lastTimeRef.current = time;

    // 1. Update Players
    playersRef.current.forEach(p => {
      // Update Trail
      p.trail.push({ ...p.pos });
      if (p.trail.length > TRAIL_LENGTH) p.trail.shift();

      if (p.stunTimer > 0) {
        p.stunTimer -= dt;
        return;
      }
      if (p.speedBoostTimer > 0) p.speedBoostTimer -= dt;

      // Determine direction from input
      let dx = 0;
      let dy = 0;
      
      if (p.id === 1) {
        if (inputState.current['p1_up']) dy = -1;
        else if (inputState.current['p1_down']) dy = 1;
        else if (inputState.current['p1_left']) dx = -1;
        else if (inputState.current['p1_right']) dx = 1;
      } else {
        if (inputState.current['p2_up']) dy = -1;
        else if (inputState.current['p2_down']) dy = 1;
        else if (inputState.current['p2_left']) dx = -1;
        else if (inputState.current['p2_right']) dx = 1;
      }

      // Grid-based movement logic
      const speed = PLAYER_SPEED * (p.speedBoostTimer > 0 ? BOOST_MULTIPLIER : 1) * dt;
      
      // Try moving in intended direction
      const nextX = p.pos.x + dx * speed;
      const nextY = p.pos.y + dy * speed;

      // Wall Collision Check
      const checkWall = (x: number, y: number) => {
        const gridX = Math.floor(x);
        const gridY = Math.floor(y);
        return gridRef.current[gridY] && gridRef.current[gridY][gridX] === 1;
      };

      const margin = 0.35; 
      let moved = false;
      
      // X Movement
      if (dx !== 0) {
        const testX = nextX + 0.5 + (dx > 0 ? margin : -margin);
        if (!checkWall(testX, p.pos.y + 0.5 - margin) && 
            !checkWall(testX, p.pos.y + 0.5 + margin)) {
          p.pos.x = nextX;
          moved = true;
        } else {
          p.pos.x = Math.round(p.pos.x);
        }
      }
      
      // Y Movement
      if (dy !== 0) {
        const testY = nextY + 0.5 + (dy > 0 ? margin : -margin);
        if (!checkWall(p.pos.x + 0.5 - margin, testY) && 
            !checkWall(p.pos.x + 0.5 + margin, testY)) {
          p.pos.y = nextY;
          moved = true;
        } else {
          p.pos.y = Math.round(p.pos.y);
        }
      }

      p.isMoving = moved;
      if (moved) {
        // Play sound every few frames for "step" effect
        if (!p.stepTimer) p.stepTimer = 0;
        p.stepTimer += dt;
        if (p.stepTimer > 0.2) { // Every 0.2 seconds
           if (p.id === 1) soundManager.playStepP1();
           else soundManager.playStepP2();
           p.stepTimer = 0;
        }
      }
    });

    // 2. Update Ghosts (AI)
    if (enemiesFrozenTimerRef.current > 0) {
        enemiesFrozenTimerRef.current -= dt;
    } else {
        ghostsRef.current.forEach(g => {
          let currentSpeed = enemySpeed;
          if (g.fleeTimer && g.fleeTimer > 0) {
              currentSpeed *= 1.8; // Move faster when fleeing
          }
          const speed = currentSpeed * dt;
          let dx = 0;
      let dy = 0;

      const checkWall = (x: number, y: number) => {
        const gridX = Math.floor(x);
        const gridY = Math.floor(y);
        return gridRef.current[gridY]?.[gridX] === 1;
      };

      // Handle Flee Timer
      if (g.fleeTimer && g.fleeTimer > 0) {
          g.fleeTimer -= dt;
          // Flee behavior: Move AWAY from nearest player
          let nearestPlayer = playersRef.current[0];
          let minDist = Infinity;
          playersRef.current.forEach(p => {
              const dist = Math.sqrt(Math.pow(p.pos.x - g.pos.x, 2) + Math.pow(p.pos.y - g.pos.y, 2));
              if (dist < minDist) {
                  minDist = dist;
                  nearestPlayer = p;
              }
          });

          // Vector away from player
          const dxRaw = g.pos.x - nearestPlayer.pos.x;
          const dyRaw = g.pos.y - nearestPlayer.pos.y;
          const len = Math.sqrt(dxRaw * dxRaw + dyRaw * dyRaw) || 1;
          
          dx = (dxRaw / len);
          dy = (dyRaw / len);
          
          // Add some randomness to avoid getting stuck
          if (Math.random() < 0.1) {
             dx += (Math.random() - 0.5);
             dy += (Math.random() - 0.5);
          }

      } else if (g.behavior === 'chase') {
        // Find nearest ACTIVE player
        let targetPlayer = null;
        let minDist = Infinity;
        
        playersRef.current.forEach(p => {
          // Only chase if player is alive (not stunned)
          if (p.stunTimer <= 0) {
            const dist = Math.sqrt(Math.pow(p.pos.x - g.pos.x, 2) + Math.pow(p.pos.y - g.pos.y, 2));
            if (dist < minDist) {
              minDist = dist;
              targetPlayer = p;
            }
          }
        });

        // Guard Logic
        const DETECTION_RADIUS = 6;
        let target = null;
        
        // 1. Chase Player if close and alive
        if (targetPlayer && minDist < DETECTION_RADIUS) {
           target = targetPlayer.pos;
           (g as any).isAlert = true;
        } else {
           (g as any).isAlert = false;
           // 2. Patrol Logic (Keep moving)
           // If far from guardPos, go back. If close, wander.
           const distToGuard = g.guardPos ? Math.sqrt(Math.pow(g.guardPos.x - g.pos.x, 2) + Math.pow(g.guardPos.y - g.pos.y, 2)) : 0;
           
           if (g.guardPos && distToGuard > 4) {
               target = g.guardPos;
           } else {
               // Wander randomly near guard pos
               if (!(g as any).patrolTarget || Math.random() < 0.05) {
                   // Pick random point near current pos
                   const rx = (Math.random() - 0.5) * 4;
                   const ry = (Math.random() - 0.5) * 4;
                   (g as any).patrolTarget = { x: g.pos.x + rx, y: g.pos.y + ry };
               }
               target = (g as any).patrolTarget;
           }
        }

        // Move towards target
        if (target) {
            if (Math.abs(target.x - g.pos.x) > 0.1) {
            dx = target.x > g.pos.x ? 1 : -1;
            }
            if (Math.abs(target.y - g.pos.y) > 0.1) {
            dy = target.y > g.pos.y ? 1 : -1;
            }
        }

        if (dx !== 0 && dy !== 0) {
          dx *= 0.707;
          dy *= 0.707;
        }

      } else {
        if (!(g as any).dir || Math.random() < 0.02) {
           const dirs = [{x:0, y:1}, {x:0, y:-1}, {x:1, y:0}, {x:-1, y:0}];
           (g as any).dir = dirs[Math.floor(Math.random() * dirs.length)];
        }
        const dir = (g as any).dir;
        dx = dir.x;
        dy = dir.y;
      }

      if (dx !== 0 || dy !== 0) {
        (g as any).lastDir = { x: dx, y: dy };
      } else if (!(g as any).lastDir) {
        (g as any).lastDir = { x: 1, y: 0 };
      }

      const nextX = g.pos.x + dx * speed;
      const nextY = g.pos.y + dy * speed;
      const margin = 0.4;

      let moved = false;
      if (dx !== 0 && !checkWall(nextX + (dx > 0 ? margin : -margin), g.pos.y + 0.5)) {
         g.pos.x = nextX;
         moved = true;
      }
      if (dy !== 0 && !checkWall(g.pos.x + 0.5, nextY + (dy > 0 ? margin : -margin))) {
         g.pos.y = nextY;
         moved = true;
      }

      if (!moved && g.behavior === 'wander') {
        (g as any).dir = null;
      }
    });
    } // End of frozen check

    // 4. Update Timer
    if (questionTimerRef.current > 0) {
       const prevRounded = Math.ceil(questionTimerRef.current);
       questionTimerRef.current -= dt;
       const rounded = Math.ceil(questionTimerRef.current);
       
       if (rounded !== timeLeft) {
          setTimeLeft(rounded);
          // Play countdown sound for last 5 seconds
          if (rounded <= 5 && rounded > 0 && rounded !== prevRounded) {
             soundManager.playVoice(rounded.toString());
          }
       }

       if (questionTimerRef.current <= 0) {
          nextRound();
          setFeedback({ msg: "Waktu Habis! Soal Selanjutnya...", type: 'info' });
       }
    }

    // 5. Check Collisions
    playersRef.current.forEach(p => {
      if (p.stunTimer > 0) return; // Invincible while stunned

      // vs Ghosts
      ghostsRef.current.forEach(g => {
        if (checkCollision(p.pos, g.pos, 0.6) && p.stunTimer <= 0) {
          if (p.hasShield) {
              p.hasShield = false;
              p.stunTimer = 3; // Still stunned (mati suri)
              // No score deduction
              setFeedback({ msg: `P${p.id} Perisai Pecah! (Nyawa Aman)`, type: 'info' });
              soundManager.playShieldBreak();
              
              // All enemies flee
              ghostsRef.current.forEach(ghost => {
                ghost.fleeTimer = 3;
              });
          } else {
              // Random stun time 5-8 seconds
              p.stunTimer = 5 + Math.random() * 3;
              
              // Point deduction logic
              const penalty = g.behavior === 'chase' ? 7 : 2;
              p.score = Math.max(0, p.score - penalty);
              
              setScores(prev => ({ ...prev, [p.id === 1 ? 'p1' : 'p2']: p.score }));
              setFeedback({ msg: `P${p.id} Tertangkap! -${penalty} Poin`, type: 'error' });
              setShake(10);
              soundManager.playDamage();
              
              // All enemies flee after hit
              ghostsRef.current.forEach(ghost => {
                ghost.fleeTimer = 5;
              });
          }
          setTimeout(() => setFeedback(null), 2000);
        }
      });

      // vs Powerups & Bonuses
      const powerupIdx = powerupsRef.current.findIndex(pu => checkCollision(p.pos, pu.pos, 0.6));
      if (powerupIdx !== -1) {
        const item = powerupsRef.current[powerupIdx];
        powerupsRef.current.splice(powerupIdx, 1);
        
        if (item.type === 'powerup') {
            p.speedBoostTimer = 5;
            setFeedback({ msg: `P${p.id} Speed Boost!`, type: 'success' });
            soundManager.playPowerup();
        } else if (item.type === 'freeze') {
            enemiesFrozenTimerRef.current = 5;
            setFeedback({ msg: `❄️ FREEZE! Musuh Beku 5 Detik!`, type: 'info' });
            soundManager.playFreeze();
        } else if (item.type === 'shield') {
            p.hasShield = true;
            setFeedback({ msg: `🛡️ P${p.id} Dapat Perisai!`, type: 'success' });
            soundManager.playShieldPickup();
        } else if (item.type === 'bonus') {
            const val = parseInt(item.value || '1');
            p.score += val;
            setScores(prev => ({ ...prev, [p.id === 1 ? 'p1' : 'p2']: p.score }));
            setFeedback({ msg: `P${p.id} +${val} Bonus!`, type: 'success' });
            soundManager.playCorrect(); // Reuse correct sound for bonus
        }
        
        setTimeout(() => setFeedback(null), 2000);
      }

      // vs Answers
      const answerIdx = answersRef.current.findIndex(a => checkCollision(p.pos, a.pos, 0.6));
      if (answerIdx !== -1 && p.stunTimer <= 0) {
        const answer = answersRef.current[answerIdx];
        const currentQ = questions[currentQuestionIndex];
        
        if (answer.value === currentQ.correct) {
          answersRef.current.splice(answerIdx, 1);
          p.streak += 1;
          const streakBonus = p.streak > 1 ? ` (Combo ${p.streak}x!)` : '';
          const points = 10 * p.streak;
          
          p.score += points;
          setScores(prev => ({ ...prev, [p.id === 1 ? 'p1' : 'p2']: p.score }));
          setFeedback({ msg: `P${p.id} Benar! +${points} Poin${streakBonus}`, type: 'success' });
          soundManager.playCorrect();
          confetti({
            particleCount: 100,
            spread: 70,
            origin: { x: p.id === 1 ? 0.2 : 0.8, y: 0.8 }
          });
          nextRound();
        } else {
          p.streak = 0; // Reset streak
          p.stunTimer = 3;
          p.score = Math.max(0, p.score - 5);
          setScores(prev => ({ ...prev, [p.id === 1 ? 'p1' : 'p2']: p.score }));
          setFeedback({ msg: `P${p.id} Salah! -5 Poin (Combo Reset)`, type: 'error' });
          setShake(5);
          soundManager.playWrong();
          answersRef.current.splice(answerIdx, 1);
          setTimeout(() => setFeedback(null), 2000);
        }
      }
    });

    draw();
    requestRef.current = requestAnimationFrame(update);
  };

  const nextRound = () => {
    if (currentQuestionIndex >= questions.length - 1) {
      endGame();
    } else {
      setIsWaitingForNextRound(true);
    }
  };

  const startPreRoundCountdown = () => {
    setIsWaitingForNextRound(false);
    setPreRoundCountdown(3);
    
    let count = 3;
    soundManager.playVoice("Tiga");
    
    const interval = setInterval(() => {
      count -= 1;
      if (count > 0) {
        setPreRoundCountdown(count);
        const words = ["", "Satu", "Dua", "Tiga"];
        soundManager.playVoice(words[count]);
      } else {
        clearInterval(interval);
        setPreRoundCountdown(null);
        setCurrentQuestionIndex(prev => {
          const nextIdx = prev + 1;
          setupRound(nextIdx);
          return nextIdx;
        });
      }
    }, 1000);
  };

  const endGame = () => {
    setGameState('finished');
    const p1Score = playersRef.current[0].score;
    const p2Score = playersRef.current[1].score;
    if (p1Score > p2Score) setWinner(1);
    else if (p2Score > p1Score) setWinner(2);
    else setWinner(0); // Draw
    soundManager.playCorrect(); // Victory sound
  };

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Apply Shake
    ctx.save();
    if (shake > 0) {
      const dx = (Math.random() - 0.5) * shake;
      const dy = (Math.random() - 0.5) * shake;
      ctx.translate(dx, dy);
      setShake(prev => Math.max(0, prev * 0.9)); // Decay shake
    }

    // Calculate Scale
    const gridW = gridRef.current[0].length;
    const gridH = gridRef.current.length;
    
    // Use CSS pixels for drawing logic
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = canvas.width / dpr;
    const cssHeight = canvas.height / dpr;
    
    // Add padding to prevent edges/shadows from being cut off
    const padding = 20; 
    const availableWidth = cssWidth - padding * 2;
    const availableHeight = cssHeight - padding * 2;
    
    const scaleX = availableWidth / gridW;
    const scaleY = availableHeight / gridH;
    const scale = Math.min(scaleX, scaleY);
    
    const offsetX = padding + (availableWidth - gridW * scale) / 2;
    const offsetY = padding + (availableHeight - gridH * scale) / 2;

    // Scale context to match DPR
    ctx.save();
    ctx.scale(dpr, dpr);

    // Draw Maze
    ctx.fillStyle = '#1e293b'; // Lighter background (slate-800)
    ctx.strokeStyle = '#94a3b8'; // Lighter stroke (slate-400)
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';

    for (let y = 0; y < gridH; y++) {
      for (let x = 0; x < gridW; x++) {
        if (gridRef.current[y][x] === 1) {
          const px = offsetX + x * scale;
          const py = offsetY + y * scale;
          
          ctx.fillStyle = '#334155'; // Lighter wall (slate-700)
          ctx.fillRect(px, py, scale + 0.5, scale + 0.5);
          
          ctx.beginPath();
          if (y === 0 || gridRef.current[y-1][x] === 0) { ctx.moveTo(px, py); ctx.lineTo(px + scale, py); }
          if (y === gridH - 1 || gridRef.current[y+1][x] === 0) { ctx.moveTo(px, py + scale); ctx.lineTo(px + scale, py + scale); }
          if (x === 0 || gridRef.current[y][x-1] === 0) { ctx.moveTo(px, py); ctx.lineTo(px, py + scale); }
          if (x === gridW - 1 || gridRef.current[y][x+1] === 0) { ctx.moveTo(px + scale, py); ctx.lineTo(px + scale, py + scale); }
          ctx.shadowColor = '#000'; // Subtle shadow
          ctx.shadowBlur = 5;
          ctx.stroke();
          ctx.shadowBlur = 0;
        } else {
           const px = offsetX + x * scale;
           const py = offsetY + y * scale;
           ctx.strokeStyle = '#334155'; // Grid lines
           ctx.lineWidth = 0.5;
           ctx.strokeRect(px, py, scale, scale);
        }
      }
    }

    // Draw Items
    answersRef.current.forEach(a => {
      const cx = offsetX + (a.pos.x + 0.5) * scale;
      const cy = offsetY + (a.pos.y + 0.5) * scale;
      const size = scale * 0.8;
      
      // Draw as a rounded square (card/block style)
      ctx.shadowColor = '#fbbf24';
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#fff';
      
      // Rounded rect helper
      const r = size * 0.2;
      const x = cx - size / 2;
      const y = cy - size / 2;
      
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + size - r, y);
      ctx.quadraticCurveTo(x + size, y, x + size, y + r);
      ctx.lineTo(x + size, y + size - r);
      ctx.quadraticCurveTo(x + size, y + size, x + size - r, y + size);
      ctx.lineTo(x + r, y + size);
      ctx.quadraticCurveTo(x, y + size, x, y + size - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
      ctx.fill();
      
      // Border
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 2;
      ctx.stroke();
      
      ctx.shadowBlur = 0;
      
      ctx.fillStyle = '#000';
      ctx.font = `bold ${scale * 0.5}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(a.value || '?', cx, cy);
    });

    powerupsRef.current.forEach(p => {
      const cx = offsetX + (p.pos.x + 0.5) * scale;
      const cy = offsetY + (p.pos.y + 0.5) * scale;
      
      if (p.type === 'powerup') {
        ctx.fillStyle = '#facc15';
        ctx.beginPath();
        ctx.arc(cx, cy, scale * 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#000';
        ctx.font = `${scale * 0.4}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⚡', cx, cy);
      } else if (p.type === 'freeze') {
        ctx.fillStyle = '#3b82f6'; // Blue for freeze
        ctx.beginPath();
        ctx.arc(cx, cy, scale * 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = `${scale * 0.4}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('❄️', cx, cy);
      } else if (p.type === 'shield') {
        ctx.fillStyle = '#fbbf24'; // Gold for shield
        ctx.beginPath();
        ctx.arc(cx, cy, scale * 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = `${scale * 0.4}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🛡️', cx, cy);
      } else if (p.type === 'bonus') {
        ctx.fillStyle = '#10b981'; // Emerald green for bonus
        ctx.beginPath();
        ctx.arc(cx, cy, scale * 0.25, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${scale * 0.3}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.value || '1', cx, cy);
      }
    });

    // Draw Ghosts
    ghostsRef.current.forEach(g => {
      const cx = offsetX + (g.pos.x + 0.5) * scale;
      const cy = offsetY + (g.pos.y + 0.5) * scale;
      
      const mouthOpen = Math.abs(Math.sin(Date.now() / 100)) * 0.2 * Math.PI;
      let angle = 0;
      const dir = (g as any).lastDir || {x: 1, y: 0};
      if (dir.x > 0) angle = 0;
      else if (dir.x < 0) angle = Math.PI;
      else if (dir.y > 0) angle = Math.PI / 2;
      else if (dir.y < 0) angle = -Math.PI / 2;
      
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      ctx.fillStyle = g.behavior === 'chase' ? '#ef4444' : '#facc15';
      ctx.beginPath();
      ctx.arc(0, 0, scale * 0.4, mouthOpen, Math.PI * 2 - mouthOpen);
      ctx.lineTo(0, 0);
      ctx.fill();
      ctx.restore();

      // Frozen Effect
      if (enemiesFrozenTimerRef.current > 0) {
          ctx.save();
          ctx.translate(cx, cy);
          ctx.fillStyle = 'rgba(59, 130, 246, 0.5)'; // Transparent blue
          ctx.beginPath();
          ctx.arc(0, 0, scale * 0.45, 0, Math.PI * 2);
          ctx.fill();
          ctx.font = `${scale * 0.3}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('❄️', 0, -scale * 0.5);
          ctx.restore();
      }

      if (g.behavior === 'chase' && enemiesFrozenTimerRef.current <= 0) {
         ctx.fillStyle = '#ef4444';
         ctx.font = `bold ${scale * 0.4}px sans-serif`;
         ctx.fillText('!', cx, cy - scale * 0.5);
      }
    });

    // Draw Players
    playersRef.current.forEach(p => {
      const cx = offsetX + (p.pos.x + 0.5) * scale;
      const cy = offsetY + (p.pos.y + 0.5) * scale;
      
      // Draw Trail
      if (p.trail.length > 1) {
        ctx.beginPath();
        ctx.strokeStyle = p.color;
        ctx.lineWidth = scale * 0.2;
        ctx.globalAlpha = 0.3;
        p.trail.forEach((pos, i) => {
          const tx = offsetX + (pos.x + 0.5) * scale;
          const ty = offsetY + (pos.y + 0.5) * scale;
          if (i === 0) ctx.moveTo(tx, ty);
          else ctx.lineTo(tx, ty);
        });
        ctx.stroke();
        ctx.globalAlpha = 1.0;
      }

      // Shield Effect
      if (p.hasShield) {
          ctx.beginPath();
          ctx.arc(cx, cy, scale * 0.5, 0, Math.PI * 2);
          ctx.strokeStyle = '#fbbf24'; // Gold
          ctx.lineWidth = 3;
          ctx.stroke();
          ctx.fillStyle = 'rgba(251, 191, 36, 0.2)';
          ctx.fill();
      }

      // Stun effect
      if (p.stunTimer > 0) {
        ctx.globalAlpha = 0.5;
      }

      // Player Animation (Bounce/Wobble)
      ctx.save();
      ctx.translate(cx, cy);
      if (p.isMoving) {
        const bounce = Math.sin(Date.now() / 100) * 0.1;
        ctx.scale(1 + bounce, 1 - bounce);
      }
      
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(0, 0, scale * 0.4, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.font = `${scale * 0.6}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.avatar, 0, 0);
      
      ctx.restore();

      if (p.speedBoostTimer > 0) {
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, scale * 0.4, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.globalAlpha = 1.0;
    });
    
    ctx.restore();
  };

  useEffect(() => {
    if (gameState === 'playing') {
      requestRef.current = requestAnimationFrame(update);
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [gameState, currentQuestionIndex]);

  useEffect(() => {
    if (gameState === 'playing' && containerRef.current && canvasRef.current) {
      const resizeObserver = new ResizeObserver(entries => {
        window.requestAnimationFrame(() => {
          if (!Array.isArray(entries) || !entries.length) return;
          for (let entry of entries) {
            if (canvasRef.current && gridRef.current) {
              const dpr = window.devicePixelRatio || 1;
              const minScale = 25; // Minimum 25px per cell
              const padding = 20;
              
              const gridW = gridRef.current[0].length;
              const gridH = gridRef.current.length;
              
              // Calculate scale to fit container, but don't go below minScale
              // Use window dimensions as a fallback if container is 0
              const containerW = entry.contentRect.width || window.innerWidth;
              const containerH = entry.contentRect.height || window.innerHeight;
              
              let scaleX = (containerW - padding * 2) / gridW;
              let scaleY = (containerH - padding * 2) / gridH;
              let scale = Math.max(minScale, Math.min(scaleX, scaleY));
              
              const canvasW = gridW * scale + padding * 2;
              const canvasH = gridH * scale + padding * 2;
              
              // Set CSS size
              canvasRef.current.style.width = `${canvasW}px`;
              canvasRef.current.style.height = `${canvasH}px`;
              
              // Set actual size
              canvasRef.current.width = canvasW * dpr;
              canvasRef.current.height = canvasH * dpr;
            }
          }
        });
      });
      resizeObserver.observe(containerRef.current);
      return () => resizeObserver.disconnect();
    }
  }, [gameState]);

  // --- Input Handlers ---
  const handleTouchStart = (key: string) => (e: React.SyntheticEvent) => {
    inputState.current[key] = true;
  };
  
  const handleTouchEnd = (key: string) => (e: React.SyntheticEvent) => {
    inputState.current[key] = false;
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp') inputState.current['p2_up'] = true;
      if (e.key === 'ArrowDown') inputState.current['p2_down'] = true;
      if (e.key === 'ArrowLeft') inputState.current['p2_left'] = true;
      if (e.key === 'ArrowRight') inputState.current['p2_right'] = true;
      
      if (e.key === 'w') inputState.current['p1_up'] = true;
      if (e.key === 's') inputState.current['p1_down'] = true;
      if (e.key === 'a') inputState.current['p1_left'] = true;
      if (e.key === 'd') inputState.current['p1_right'] = true;
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp') inputState.current['p2_up'] = false;
      if (e.key === 'ArrowDown') inputState.current['p2_down'] = false;
      if (e.key === 'ArrowLeft') inputState.current['p2_left'] = false;
      if (e.key === 'ArrowRight') inputState.current['p2_right'] = false;
      
      if (e.key === 'w') inputState.current['p1_up'] = false;
      if (e.key === 's') inputState.current['p1_down'] = false;
      if (e.key === 'a') inputState.current['p1_left'] = false;
      if (e.key === 'd') inputState.current['p1_right'] = false;
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // --- Question Editor Handlers ---
  const addQuestion = () => {
    setQuestions([...questions, { ...editingQuestion } as Question]);
    setEditingQuestion({
      question: '',
      options: { A: '', B: '', C: '', D: '' },
      correct: 'A',
      subject: 'Umum'
    });
  };

  const deleteQuestion = (index: number) => {
    const newQ = [...questions];
    newQ.splice(index, 1);
    setQuestions(newQ);
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setCustomLogo(url);
    }
  };

  // --- Render ---
  return (
    <div className="w-full min-h-[100dvh] bg-slate-900 text-white flex flex-col font-sans">
      
      {/* Splash Screen */}
      <AnimatePresence>
        {gameState === 'splash' && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-gradient-to-br from-blue-950 via-indigo-900 to-purple-950 text-white overflow-hidden"
          >
            {/* Background Particles */}
            <div className="absolute inset-0 opacity-30 pointer-events-none">
                {[...Array(30)].map((_, i) => (
                    <motion.div
                        key={i}
                        className="absolute bg-white rounded-full blur-sm"
                        initial={{ x: Math.random() * window.innerWidth, y: Math.random() * window.innerHeight, scale: 0 }}
                        animate={{ 
                          y: [null, Math.random() * -100], 
                          opacity: [0, 0.8, 0],
                          scale: [0, Math.random() * 1.5, 0]
                        }}
                        transition={{ duration: 3 + Math.random() * 4, repeat: Infinity, ease: "linear" }}
                        style={{ width: Math.random() * 6 + 2, height: Math.random() * 6 + 2 }}
                    />
                ))}
            </div>

            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              className="relative z-10 max-w-4xl w-[90%] bg-white/10 backdrop-blur-xl p-10 rounded-[3rem] border border-white/20 shadow-2xl flex flex-col items-center text-center"
            >
              {/* Logo Section - Click to Upload */}
              <div className="group relative mb-8 cursor-pointer" onClick={() => document.getElementById('logo-upload')?.click()}>
                <input 
                  type="file" 
                  id="logo-upload" 
                  className="hidden" 
                  accept="image/*" 
                  onChange={handleLogoUpload} 
                />
                
                <motion.div 
                  whileHover={{ scale: 1.05, rotate: 5 }}
                  className="relative"
                >
                  {customLogo ? (
                    <img src={customLogo} alt="School Logo" className="w-64 h-64 object-contain drop-shadow-2xl" />
                  ) : (
                    <div className="relative w-64 h-64 flex items-center justify-center bg-gradient-to-tr from-orange-500 to-yellow-400 rounded-full shadow-lg shadow-orange-500/50">
                        <Shield className="w-24 h-24 text-white fill-white/20 stroke-[2]" />
                        <Sparkles className="absolute top-2 right-2 w-10 h-10 text-yellow-200 animate-pulse" />
                        <div className="absolute inset-0 flex items-center justify-center">
                            <BrainCircuit className="w-12 h-12 text-white/90" />
                        </div>
                    </div>
                  )}
                  
                  {/* Hover Hint */}
                  <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity text-sm font-medium text-blue-200 whitespace-nowrap bg-black/50 px-3 py-1 rounded-full backdrop-blur-sm">
                    Klik untuk ganti logo
                  </div>
                </motion.div>
              </div>

              <h1 className="text-5xl md:text-7xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-orange-400 via-yellow-300 to-orange-400 drop-shadow-sm mb-4 filter drop-shadow-lg">
                SDN BENDUNGAN
              </h1>
              <p className="text-blue-200 text-xl md:text-2xl font-medium tracking-widest uppercase mb-12 border-b border-blue-400/30 pb-4">
                Cerdas Cermat Maze Runner
              </p>

              <motion.button
                whileHover={{ scale: 1.05, boxShadow: "0 0 30px rgba(34, 197, 94, 0.6)" }}
                whileTap={{ scale: 0.95 }}
                onClick={() => {
                  soundManager.resume();
                  setGameState('setup');
                }}
                className="w-full max-w-md px-12 py-6 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-400 hover:to-emerald-500 rounded-full text-3xl font-bold shadow-xl shadow-green-900/50 flex items-center justify-center gap-4 border-t border-white/20 transition-all"
              >
                <div className="bg-white/20 p-2 rounded-full">
                  <Settings size={32} className="text-white" />
                </div>
                <span>MULAI MAIN</span>
              </motion.button>
              
              <div className="mt-8 text-white/40 text-sm font-mono">
                v1.2.0 • Delta Time Sync • Enhanced UI
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Setup Screen */}
      <AnimatePresence>
        {gameState === 'setup' && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }} 
            animate={{ opacity: 1, y: 0 }} 
            exit={{ opacity: 0, y: -20 }}
            className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-slate-900 p-8 overflow-y-auto"
          >
            <h2 className="text-4xl font-bold mb-8 text-white">Persiapan Permainan</h2>
            
            <div className="flex flex-col md:flex-row gap-12 mb-8 w-full max-w-4xl">
              {/* P1 Setup */}
              <div className="flex-1 bg-blue-900/30 p-6 rounded-2xl border border-blue-500/30">
                <h3 className="text-2xl font-bold text-blue-400 mb-4 flex items-center gap-2">
                  <User /> Player 1
                </h3>
                <input 
                  type="text" 
                  value={p1Name} 
                  onChange={(e) => setP1Name(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 mb-4 text-white"
                  placeholder="Nama Player 1"
                />
                <div className="grid grid-cols-4 gap-2">
                  {AVATARS.map(a => (
                    <button 
                      key={a} 
                      onClick={() => setP1Avatar(a)}
                      className={`text-3xl p-2 rounded-lg transition-all ${p1Avatar === a ? 'bg-blue-500 scale-110' : 'bg-slate-800 hover:bg-slate-700'}`}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </div>

              {/* P2 Setup */}
              <div className="flex-1 bg-red-900/30 p-6 rounded-2xl border border-red-500/30">
                <h3 className="text-2xl font-bold text-red-400 mb-4 flex items-center gap-2">
                  <User /> Player 2
                </h3>
                <input 
                  type="text" 
                  value={p2Name} 
                  onChange={(e) => setP2Name(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 mb-4 text-white"
                  placeholder="Nama Player 2"
                />
                <div className="grid grid-cols-4 gap-2">
                  {AVATARS.map(a => (
                    <button 
                      key={a} 
                      onClick={() => setP2Avatar(a)}
                      className={`text-3xl p-2 rounded-lg transition-all ${p2Avatar === a ? 'bg-red-500 scale-110' : 'bg-slate-800 hover:bg-slate-700'}`}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Configs */}
            <div className="flex gap-4 mb-8 w-full max-w-4xl">
              <div className="flex-1 flex flex-col gap-4">
                 <div className="bg-slate-800/50 p-6 rounded-2xl">
                    <h3 className="text-xl font-bold text-slate-300 mb-4 flex items-center gap-2">
                    <Ghost /> Musuh: {enemyCount}
                    </h3>
                    <input 
                    type="range" 
                    min="0" 
                    max="15" 
                    value={enemyCount} 
                    onChange={(e) => setEnemyCount(parseInt(e.target.value))}
                    className="w-full h-3 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-green-500"
                    />
                 </div>

                 <div className="bg-slate-800/50 p-6 rounded-2xl">
                    <h3 className="text-xl font-bold text-slate-300 mb-4 flex items-center gap-2">
                    <Zap size={20} className="text-yellow-400" /> Kecepatan Musuh: {enemySpeed.toFixed(1)}
                    </h3>
                    <input 
                    type="range" 
                    min="1" 
                    max="8" 
                    step="0.5"
                    value={enemySpeed} 
                    onChange={(e) => setEnemySpeed(parseFloat(e.target.value))}
                    className="w-full h-3 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-yellow-500"
                    />
                 </div>
                 
                 <label className="cursor-pointer bg-slate-800/50 p-4 rounded-2xl border border-dashed border-slate-600 hover:border-blue-500 flex items-center justify-center gap-3 transition-colors">
                    <Upload className="text-slate-400" />
                    <span className="text-sm text-slate-300 font-bold">Upload Logo Sekolah</span>
                    <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                 </label>
              </div>

              <div className="flex-1 flex flex-col gap-4">
                 <div className="bg-slate-800/50 p-6 rounded-2xl">
                    <h3 className="text-xl font-bold text-slate-300 mb-4 flex items-center gap-2">
                    <Clock /> Waktu: {questionTimeLimit}s
                    </h3>
                    <input 
                    type="range" 
                    min="10" 
                    max="300" 
                    step="10"
                    value={questionTimeLimit} 
                    onChange={(e) => setQuestionTimeLimit(parseInt(e.target.value))}
                    className="w-full h-3 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                    />
                 </div>
                 
                 <div className="flex gap-4">
                    <button 
                        onClick={() => setGameState('editor')}
                        className="bg-slate-800/50 p-4 rounded-2xl flex-1 hover:bg-slate-700 border border-slate-600 flex flex-col items-center justify-center gap-2"
                    >
                        <Edit size={24} className="text-yellow-400" />
                        <span className="font-bold text-sm">Edit Soal</span>
                    </button>

                    <button 
                        onClick={() => {
                        soundManager.isMuted = !soundManager.isMuted;
                        setIsMuted(soundManager.isMuted);
                        }}
                        className="bg-slate-800/50 p-4 rounded-2xl flex-1 hover:bg-slate-700 border border-slate-600 flex flex-col items-center justify-center gap-2"
                    >
                        {isMuted ? <VolumeX size={24} className="text-red-400" /> : <Volume2 size={24} className="text-green-400" />}
                        <span className="font-bold text-sm">{isMuted ? 'Muted' : 'Sound'}</span>
                    </button>
                 </div>
              </div>
            </div>

            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={startGame}
              className="px-12 py-4 bg-green-500 hover:bg-green-600 rounded-xl text-2xl font-bold shadow-lg flex items-center gap-3"
            >
              <Play size={24} fill="currentColor" />
              MULAI MAIN
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Question Editor */}
      <AnimatePresence>
        {gameState === 'editor' && (
          <motion.div 
            initial={{ opacity: 0, x: 50 }} 
            animate={{ opacity: 1, x: 0 }} 
            exit={{ opacity: 0, x: 50 }}
            className="absolute inset-0 z-50 bg-slate-900 p-8 overflow-y-auto flex flex-col"
          >
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-3xl font-bold">Editor Soal</h2>
              <button onClick={() => setGameState('setup')} className="px-6 py-2 bg-slate-700 rounded-lg hover:bg-slate-600">Kembali</button>
            </div>

            {/* AI Generator Section (Moved Here) */}
            <div className="mb-6 bg-indigo-900/50 p-4 rounded-xl border border-indigo-500/30">
                <h3 className="text-indigo-300 font-semibold mb-2 flex items-center gap-2">
                <Sparkles className="w-4 h-4" /> Buat Soal Otomatis (AI)
                </h3>
                
                {/* API Key Input (Visible if not in environment) */}
                {!process.env.GEMINI_API_KEY && (
                  <div className="mb-4">
                    <label className="block text-xs text-indigo-300 font-bold mb-1">Gemini API Key (untuk Deploy GitHub)</label>
                    <input 
                      type="password" 
                      placeholder="Masukkan Gemini API Key Anda..." 
                      className="w-full bg-black/30 border border-indigo-500/50 rounded-lg px-4 py-2 text-white placeholder-indigo-400/50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      value={customApiKey}
                      onChange={(e) => {
                        setCustomApiKey(e.target.value);
                        localStorage.setItem('gemini_api_key', e.target.value);
                      }}
                    />
                    <p className="text-[10px] text-indigo-400/70 mt-1">
                      Dapatkan kunci di <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="underline">Google AI Studio</a>. Kunci disimpan di browser Anda.
                    </p>
                  </div>
                )}

                <div className="flex flex-col md:flex-row gap-2">
                  <input 
                      type="text" 
                      placeholder="Topik (misal: Sejarah, Matematika)" 
                      className="flex-[2] bg-black/30 border border-indigo-500/50 rounded-lg px-4 py-2 text-white placeholder-indigo-400/50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      value={aiTopic}
                      onChange={(e) => setAiTopic(e.target.value)}
                  />
                  <div className="flex items-center gap-2 bg-black/30 px-3 rounded-lg border border-indigo-500/50">
                    <span className="text-xs text-indigo-300 font-bold whitespace-nowrap">Jumlah: {aiQuestionCount}</span>
                    <input 
                      type="range" 
                      min="1" 
                      max="20" 
                      step="1"
                      value={aiQuestionCount}
                      onChange={(e) => setAiQuestionCount(parseInt(e.target.value))}
                      className="w-24 h-2 bg-indigo-900 rounded-lg appearance-none cursor-pointer accent-indigo-400"
                    />
                  </div>
                  <button
                      onClick={generateQuestions}
                      disabled={isGenerating}
                      className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 disabled:cursor-not-allowed px-6 py-2 rounded-lg font-bold transition-colors flex items-center gap-2 justify-center"
                  >
                      {isGenerating ? <RefreshCw className="animate-spin w-5 h-5" /> : <BrainCircuit className="w-5 h-5" />}
                      {isGenerating ? 'Membuat...' : 'Buat Soal'}
                  </button>
                </div>
            </div>

            <div className="flex gap-8 flex-1 min-h-0">
              {/* Form */}
              <div className="w-1/3 bg-slate-800 p-6 rounded-xl overflow-y-auto">
                <h3 className="text-xl font-bold mb-4 text-blue-400">Tambah Soal Baru</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-slate-400 mb-1">Pertanyaan</label>
                    <textarea 
                      className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white"
                      rows={3}
                      value={editingQuestion.question}
                      onChange={e => setEditingQuestion({...editingQuestion, question: e.target.value})}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    {['A', 'B', 'C', 'D'].map(opt => (
                      <div key={opt}>
                        <label className="block text-sm text-slate-400 mb-1">Opsi {opt}</label>
                        <input 
                          className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white"
                          value={editingQuestion.options?.[opt as keyof typeof editingQuestion.options]}
                          onChange={e => setEditingQuestion({
                            ...editingQuestion, 
                            options: { ...editingQuestion.options!, [opt]: e.target.value }
                          })}
                        />
                      </div>
                    ))}
                  </div>
                  <div>
                    <label className="block text-sm text-slate-400 mb-1">Jawaban Benar</label>
                    <select 
                      className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white"
                      value={editingQuestion.correct}
                      onChange={e => setEditingQuestion({...editingQuestion, correct: e.target.value})}
                    >
                      {['A', 'B', 'C', 'D'].map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                  <button 
                    onClick={addQuestion}
                    disabled={!editingQuestion.question || !editingQuestion.options?.A}
                    className="w-full py-3 bg-blue-600 hover:bg-blue-500 rounded-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <Plus size={20} /> Tambah ke Daftar
                  </button>
                </div>
              </div>

              {/* List */}
              <div className="flex-1 bg-slate-800 p-6 rounded-xl overflow-y-auto">
                <h3 className="text-xl font-bold mb-4 text-green-400">Daftar Soal ({questions.length})</h3>
                <div className="space-y-3">
                  {questions.map((q, i) => (
                    <div key={i} className="bg-slate-900 p-4 rounded-lg border border-slate-700 flex justify-between items-start">
                      <div>
                        <div className="font-bold mb-1">{q.question}</div>
                        <div className="text-sm text-slate-400 grid grid-cols-2 gap-x-4">
                          <span className={q.correct === 'A' ? 'text-green-400 font-bold' : ''}>A: {q.options.A}</span>
                          <span className={q.correct === 'B' ? 'text-green-400 font-bold' : ''}>B: {q.options.B}</span>
                          <span className={q.correct === 'C' ? 'text-green-400 font-bold' : ''}>C: {q.options.C}</span>
                          <span className={q.correct === 'D' ? 'text-green-400 font-bold' : ''}>D: {q.options.D}</span>
                        </div>
                      </div>
                      <button onClick={() => deleteQuestion(i)} className="text-red-400 hover:text-red-300 p-2">
                        <Trash2 size={20} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Game HUD */}
      {gameState === 'playing' && (
        <div className="relative flex-1 flex flex-col">
          {/* Top Bar: Question & Scores - Compact Version */}
          <div className="min-h-24 h-auto bg-slate-800/95 border-b border-slate-700 flex flex-row items-center justify-between px-4 py-2 z-10 shadow-xl gap-2">
            {/* P1 Score */}
            <div className="flex flex-col items-center w-24 bg-blue-900/50 p-1.5 rounded-lg border border-blue-500/30 shrink-0">
              <span className="text-blue-400 font-bold text-[10px] truncate w-full text-center">{p1Name}</span>
              <div className="flex items-center gap-1">
                <span className="text-xl">{p1Avatar}</span>
                <span className="text-3xl font-black text-white">{scores.p1}</span>
              </div>
            </div>

            {/* Question Area */}
            <div className="flex-1 flex flex-col items-center relative justify-center px-2">
              {/* Timer & Subject Header */}
              <div className="flex items-center gap-3 mb-1">
                <span className="text-slate-400 text-[10px] font-bold uppercase tracking-wider">
                  Soal {currentQuestionIndex + 1}/{questions.length}
                </span>
                <span className={`px-4 py-1.5 rounded-full font-mono font-bold text-3xl flex items-center gap-2 shadow-inner ${timeLeft <= 10 ? 'bg-red-500/30 text-red-400 animate-pulse border-2 border-red-500/50' : 'bg-slate-700 text-slate-100 border-2 border-slate-600'}`}>
                  <Clock size={24} /> {timeLeft}s
                </span>
                
                {/* Fullscreen Toggle Button */}
                <button 
                  onClick={toggleFullscreen}
                  className="bg-slate-700 hover:bg-slate-600 text-slate-300 p-1 rounded-md border border-slate-600 transition-colors"
                  title="Toggle Fullscreen"
                >
                  {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                </button>
              </div>

              {/* Question Text - Compact */}
              <div className="text-lg md:text-xl font-bold text-center leading-tight mb-2 text-white drop-shadow-md max-w-3xl line-clamp-2">
                {questions[currentQuestionIndex]?.question}
              </div>

              {/* Options - Compact */}
              <div className="flex flex-wrap justify-center gap-2">
                {questions[currentQuestionIndex] && Object.entries(questions[currentQuestionIndex].options).map(([key, val]) => (
                  <div key={key} className="px-2 py-0.5 bg-slate-700/80 rounded-lg text-xs border border-slate-600 flex items-center gap-1.5">
                    <span className="bg-yellow-500 text-black font-bold w-4 h-4 rounded-full flex items-center justify-center text-[10px]">{key}</span>
                    <span className="text-slate-100 font-medium truncate max-w-[100px]">{val}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* P2 Score */}
            <div className="flex flex-col items-center w-24 bg-red-900/50 p-1.5 rounded-lg border border-red-500/30 shrink-0">
              <span className="text-red-400 font-bold text-[10px] truncate w-full text-center">{p2Name}</span>
              <div className="flex items-center gap-1">
                <span className="text-3xl font-black text-white">{scores.p2}</span>
                <span className="text-xl">{p2Avatar}</span>
              </div>
            </div>
            
            {/* Quick Controls */}
            <div className="flex flex-col gap-1 shrink-0">
               <button 
                 onClick={nextRound}
                 className="bg-slate-700 hover:bg-slate-600 text-slate-300 p-1 rounded-md border border-slate-600 transition-colors"
                 title="Skip Soal"
               >
                 <SkipForward size={14} />
               </button>
               <button 
                 onClick={() => setGameState('setup')}
                 className="bg-red-900/40 hover:bg-red-900/60 text-red-300 p-1 rounded-md border border-red-800/50 transition-colors"
                 title="Keluar"
               >
                 <LogOut size={14} />
               </button>
            </div>
          </div>

          {/* Feedback Overlay */}
          <AnimatePresence>
            {feedback && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className={`absolute top-36 left-1/2 -translate-x-1/2 px-6 py-3 rounded-full font-bold text-lg shadow-lg z-30 ${
                  feedback.type === 'success' ? 'bg-green-500 text-white' : 
                  feedback.type === 'error' ? 'bg-red-500 text-white' : 'bg-blue-500 text-white'
                }`}
              >
                {feedback.msg}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Canvas Container & Controls Overlay */}
          <div ref={containerRef} className="flex-1 relative bg-slate-800 overflow-hidden p-2 flex items-center justify-center">
            <canvas 
              ref={canvasRef}
              className="block bg-slate-800 shadow-2xl rounded-lg"
              style={{ touchAction: 'pan-x pan-y' }}
            />

            {/* Waiting for Next Round Overlay */}
            <AnimatePresence>
              {isWaitingForNextRound && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-slate-900/80 backdrop-blur-md"
                >
                  <motion.div
                    initial={{ scale: 0.8, y: 20 }}
                    animate={{ scale: 1, y: 0 }}
                    className="bg-slate-800 p-8 rounded-3xl border border-white/10 shadow-2xl flex flex-col items-center text-center max-w-md"
                  >
                    <div className="w-20 h-20 bg-green-500/20 rounded-full flex items-center justify-center mb-6">
                      <SkipForward size={40} className="text-green-500" />
                    </div>
                    <h2 className="text-3xl font-black mb-2">SOAL SELESAI!</h2>
                    <p className="text-slate-400 mb-8">Siap untuk tantangan berikutnya?</p>
                    <button
                      onClick={startPreRoundCountdown}
                      className="w-full py-4 bg-green-500 hover:bg-green-400 text-white rounded-2xl text-2xl font-black shadow-lg shadow-green-500/20 transition-all active:scale-95"
                    >
                      LANJUT
                    </button>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Pre-Round Countdown Overlay */}
            <AnimatePresence>
              {preRoundCountdown !== null && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-50 flex items-center justify-center bg-slate-900/40 pointer-events-none"
                >
                  <motion.div
                    key={preRoundCountdown}
                    initial={{ scale: 2, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.5, opacity: 0 }}
                    className="text-[12rem] font-black text-white drop-shadow-[0_0_30px_rgba(255,255,255,0.5)]"
                  >
                    {preRoundCountdown}
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* P1 Controls (Overlay - Left Center) */}
            <div className="fixed top-1/2 -translate-y-1/2 left-8 z-20 flex flex-col items-center gap-2 opacity-80 hover:opacity-100 transition-opacity">
              <div className="text-blue-400 font-bold text-sm mb-1 shadow-black drop-shadow-md">{p1Name}</div>
              <div className="grid grid-cols-3 gap-2">
                <div />
                <ControlButton color="bg-blue-600/80" activeColor="bg-blue-500" onPressStart={handleTouchStart('p1_up')} onPressEnd={handleTouchEnd('p1_up')} icon="UP" />
                <div />
                <ControlButton color="bg-blue-600/80" activeColor="bg-blue-500" onPressStart={handleTouchStart('p1_left')} onPressEnd={handleTouchEnd('p1_left')} icon="LEFT" />
                <ControlButton color="bg-blue-600/80" activeColor="bg-blue-500" onPressStart={handleTouchStart('p1_down')} onPressEnd={handleTouchEnd('p1_down')} icon="DOWN" />
                <ControlButton color="bg-blue-600/80" activeColor="bg-blue-500" onPressStart={handleTouchStart('p1_right')} onPressEnd={handleTouchEnd('p1_right')} icon="RIGHT" />
              </div>
            </div>

            {/* P2 Controls (Overlay - Right Center) */}
            <div className="fixed top-1/2 -translate-y-1/2 right-8 z-20 flex flex-col items-center gap-2 opacity-80 hover:opacity-100 transition-opacity">
              <div className="text-red-400 font-bold text-sm mb-1 shadow-black drop-shadow-md">{p2Name}</div>
              <div className="grid grid-cols-3 gap-2">
                <div />
                <ControlButton color="bg-red-600/80" activeColor="bg-red-500" onPressStart={handleTouchStart('p2_up')} onPressEnd={handleTouchEnd('p2_up')} icon="UP" />
                <div />
                <ControlButton color="bg-red-600/80" activeColor="bg-red-500" onPressStart={handleTouchStart('p2_left')} onPressEnd={handleTouchEnd('p2_left')} icon="LEFT" />
                <ControlButton color="bg-red-600/80" activeColor="bg-red-500" onPressStart={handleTouchStart('p2_down')} onPressEnd={handleTouchEnd('p2_down')} icon="DOWN" />
                <ControlButton color="bg-red-600/80" activeColor="bg-red-500" onPressStart={handleTouchStart('p2_right')} onPressEnd={handleTouchEnd('p2_right')} icon="RIGHT" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Game Over Screen */}
      {gameState === 'finished' && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-slate-900/95 backdrop-blur-sm">
          <Trophy size={80} className="text-yellow-400 mb-6" />
          <h2 className="text-5xl font-black text-white mb-2">PERMAINAN SELESAI</h2>
          <div className="text-2xl text-slate-300 mb-8">
            {winner === 0 ? "SERI!" : `PEMENANG: PLAYER ${winner}!`}
          </div>
          
          <div className="flex gap-8 mb-12">
            <div className="text-center">
              <div className="text-blue-400 font-bold">{p1Name}</div>
              <div className="text-6xl font-black text-white">{scores.p1}</div>
            </div>
            <div className="w-px bg-slate-600"></div>
            <div className="text-center">
              <div className="text-red-400 font-bold">{p2Name}</div>
              <div className="text-6xl font-black text-white">{scores.p2}</div>
            </div>
          </div>

          <button
            onClick={() => setGameState('setup')}
            className="px-8 py-4 bg-indigo-600 hover:bg-indigo-700 rounded-xl text-xl font-bold flex items-center gap-3"
          >
            <RefreshCw /> Main Lagi
          </button>
        </div>
      )}
    </div>
  );
}

// --- Subcomponents ---

const ControlButton = ({ 
  color, 
  activeColor, 
  onPressStart, 
  onPressEnd, 
  icon 
}: { 
  color: string; 
  activeColor: string; 
  onPressStart: any; 
  onPressEnd: any; 
  icon: 'UP' | 'DOWN' | 'LEFT' | 'RIGHT' 
}) => {
  return (
    <button
      className={`w-16 h-16 md:w-20 md:h-20 rounded-xl shadow-lg border-b-4 border-black/20 active:border-b-0 active:translate-y-1 transition-all flex items-center justify-center ${color} active:${activeColor}`}
      onPointerDown={(e) => {
        try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (err) {}
        onPressStart(e);
      }}
      onPointerEnter={(e) => {
        if (e.buttons > 0) {
          onPressStart(e);
        }
      }}
      onPointerUp={onPressEnd}
      onPointerOut={onPressEnd}
      onPointerCancel={onPressEnd}
      onContextMenu={(e) => e.preventDefault()}
      style={{ touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none' }}
    >
      {icon === 'UP' && <div className="w-0 h-0 border-l-[10px] border-l-transparent border-r-[10px] border-r-transparent border-b-[16px] border-b-white" />}
      {icon === 'DOWN' && <div className="w-0 h-0 border-l-[10px] border-l-transparent border-r-[10px] border-r-transparent border-t-[16px] border-t-white" />}
      {icon === 'LEFT' && <div className="w-0 h-0 border-t-[10px] border-t-transparent border-b-[10px] border-b-transparent border-r-[16px] border-r-white" />}
      {icon === 'RIGHT' && <div className="w-0 h-0 border-t-[10px] border-t-transparent border-b-[10px] border-b-transparent border-l-[16px] border-l-white" />}
    </button>
  );
};
