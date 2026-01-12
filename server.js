const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const axios = require('axios');
const WebSocket = require('ws');

const app = express();
const PORT = 3000;

// CONFIGURAÇÃO DO COMFYUI (Dinâmica)
// Default Zrok address, pode ser alterado via API
let COMFY_API_URL = "https://5uruggdvp6an.share.zrok.io"; 
let COMFY_WS_URL = "wss://5uruggdvp6an.share.zrok.io/ws";

// CONFIGURAÇÃO AXIOS PARA ZROK
axios.defaults.headers.common['skip_zrok_interstitial'] = '1';

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(express.static('public'));
app.use('/gallery', express.static('gallery'));

const GALLERY_DIR = path.join(__dirname, 'gallery');
if (!fs.existsSync(GALLERY_DIR)) fs.mkdirSync(GALLERY_DIR);

// Memória de Jobs e Estado
const activeJobs = new Map(); 
let currentRunningPromptId = null; 
let isComfyUIConnected = false; 
let wsConnection = null;

// Rotina de limpeza de jobs estagnados (Ex: WebSocket caiu e não reportou erro)
setInterval(() => {
    const now = Date.now();
    for (let [id, job] of activeJobs) {
        // Se um job está 'processing' há mais de 20 minutos, provavelmente travou
        if (job.status === 'processing' && (now - job.startTime > 20 * 60 * 1000)) {
            console.log(`[Cleaner] Removendo job estagnado: ${id}`);
            activeJobs.delete(id);
        }
    }
}, 60000); // Roda a cada 1 minuto

// --- FUNÇÃO AUXILIAR PARA SALVAR METADADOS E FINALIZAR ---
function finalizeJob(promptId, filename, job) {
    if (!job) return;

    // Salvar Metadados (JSON sidecar)
    if (job.metadata) {
        const jsonFilename = filename.replace('.png', '.json');
        const jsonPath = path.join(GALLERY_DIR, jsonFilename);
        try {
            fs.writeFileSync(jsonPath, JSON.stringify(job.metadata, null, 2));
        } catch (e) {
            console.error(`[Servidor] Erro ao salvar metadados para ${promptId}:`, e);
        }
    }

    job.status = 'completed';
    job.progress = 100;
    job.outputUrl = `/gallery/${filename}`;
    job.filename = filename;
    job.completedAt = Date.now(); // Marca temporal para debug
    activeJobs.set(promptId, job);

    console.log(`[Servidor] Job ${promptId} concluído com sucesso (Imagem Salva).`);
    
    // Auto-limpeza da memória após 30s para garantir que o front pegue a atualização
    setTimeout(() => {
        if (activeJobs.has(promptId)) {
            activeJobs.delete(promptId);
        }
    }, 30000);
}

// --- WEBSOCKET LISTENER ---
function connectToComfyWS() {
    // Se já existir conexão anterior, fecha
    if (wsConnection) {
        try { 
            wsConnection.terminate(); 
            console.log('[Servidor] Reiniciando conexão WS...');
        } catch(e){}
    }

    const clientId = "server_node_manager";
    // Header necessário para passar pelo tunnel do Zrok, se aplicável
    const wsOptions = { headers: { 'skip_zrok_interstitial': '1' } };

    // Ajuste de protocolo se necessário (ws vs wss)
    let wsUrl = COMFY_WS_URL;
    if (!wsUrl.includes('clientId=')) {
        wsUrl += `?clientId=${clientId}`;
    }

    console.log(`[Servidor] Tentando conectar WebSocket em: ${COMFY_WS_URL}`);
    
    try {
        const ws = new WebSocket(wsUrl, wsOptions);
        wsConnection = ws;

        ws.on('open', () => {
            console.log('[Servidor] Conectado ao ComfyUI');
            isComfyUIConnected = true; 
        });
        
        ws.on('message', async (data, isBinary) => {
            // --- 1. TRATAMENTO DE IMAGEM BINÁRIA (SaveImageWebsocket) ---
            if (isBinary) {
                // Lógica de Matching Melhorada
                // Tenta encontrar o job correto para esta imagem
                let targetPromptId = currentRunningPromptId;
                
                if (!targetPromptId) {
                    // Fallback 1: Procura o job mais recente em processamento
                    // Iteramos de trás para frente (mais recente primeiro se Map mantiver ordem de inserção) ou checamos startTime
                    let latestTime = 0;
                    for (let [pid, job] of activeJobs) {
                        if (job.status === 'processing' && job.startTime > latestTime) {
                            targetPromptId = pid;
                            latestTime = job.startTime;
                        }
                    }
                }

                // Fallback 2 (CRÍTICO PARA O FIX): Se não achou processando, procura um 'completed' 
                // que tenha terminado nos últimos 20 segundos mas NÃO tenha URL de imagem ainda.
                // Isso acontece se o evento 'execution_success' veio antes da imagem e o timeout forçou a conclusão.
                if (!targetPromptId) {
                    const now = Date.now();
                    for (let [pid, job] of activeJobs) {
                        // Verifica se foi completado recentemente e não tem outputUrl válido (foi forçado)
                        if (job.status === 'completed' && !job.outputUrl && (now - (job.forcedCompletionTime || 0) < 20000)) {
                            console.log(`[Servidor] Imagem atrasada encontrada para job forçado: ${pid}`);
                            targetPromptId = pid;
                            break;
                        }
                    }
                }

                if (targetPromptId && activeJobs.has(targetPromptId)) {
                    try {
                        // Ignora os primeiros 8 bytes (cabeçalho do protocolo ComfyUI: type(4) + format(4))
                        const imageBuffer = data.subarray(8); 
                        
                        const baseName = `img_${Date.now()}_${targetPromptId}`;
                        const finalFilename = `${baseName}.png`;
                        const savePath = path.join(GALLERY_DIR, finalFilename);

                        fs.writeFileSync(savePath, imageBuffer);

                        const job = activeJobs.get(targetPromptId);
                        finalizeJob(targetPromptId, finalFilename, job);
                        
                        // Limpa o ID atual se coincidir
                        if (currentRunningPromptId === targetPromptId) {
                            currentRunningPromptId = null;
                        }
                    } catch (err) {
                        console.error("[Servidor] Erro ao salvar imagem via WebSocket:", err);
                    }
                } else {
                    console.warn("[Servidor] Imagem binária recebida e descartada. Nenhum Job correspondente encontrado.");
                }
                return;
            }

            // --- 2. TRATAMENTO DE MENSAGENS JSON ---
            try {
                const msg = JSON.parse(data.toString());
                
                if (msg.type === 'execution_start') {
                    const promptId = msg.data.prompt_id;
                    currentRunningPromptId = promptId;
                    console.log(`[Servidor] Execução iniciada: ${promptId}`);
                    
                    if (activeJobs.has(promptId)) {
                        const job = activeJobs.get(promptId);
                        job.status = 'processing';
                        job.progress = 0;
                        activeJobs.set(promptId, job);
                    }
                }
                
                if (msg.type === 'progress') {
                    const { value, max } = msg.data;
                    // Atualiza o progresso do job atual
                    if (currentRunningPromptId && activeJobs.has(currentRunningPromptId)) {
                        const job = activeJobs.get(currentRunningPromptId);
                        job.progress = Math.round((value / max) * 100);
                        activeJobs.set(currentRunningPromptId, job);
                    }
                }

                if (msg.type === 'execution_success') {
                    const promptId = msg.data.prompt_id;
                    console.log(`[Servidor] Execução reportada como sucesso: ${promptId}`);

                    // NÃO finaliza imediatamente se estivermos esperando uma imagem via websocket.
                    // AUMENTADO O TIMEOUT DE 3s PARA 15s para suportar conexões lentas ou imagens pesadas
                    
                    setTimeout(() => {
                        if (activeJobs.has(promptId)) {
                            const job = activeJobs.get(promptId);
                            
                            // Se após o timeout o status ainda não for completed com URL, 
                            // significa que a imagem não chegou ou falhou.
                            if (job.status !== 'completed' || !job.outputUrl) {
                                console.log(`[Servidor] Aviso: Job ${promptId} finalizou sucesso, mas imagem não chegou no tempo limite (15s). Forçando conclusão.`);
                                
                                job.status = 'completed'; 
                                job.progress = 100;
                                job.forcedCompletionTime = Date.now(); // Marca para permitir resgate tardio se a imagem chegar logo depois
                                activeJobs.set(promptId, job);
                                
                                // Dá mais 20 segundos de chance antes de apagar da memória
                                setTimeout(() => activeJobs.delete(promptId), 20000);
                            }
                        }
                        
                        // Limpa o ponteiro global APENAS se ainda for este job
                        if (currentRunningPromptId === promptId) {
                            currentRunningPromptId = null;
                        }
                    }, 15000); // 15 segundos de tolerância
                }
            } catch (e) {
                // Erros de parse JSON são esperados em pings ou outros dados
            }
        });

        ws.on('close', () => {
            console.log('[Servidor] WebSocket desconectado.');
            isComfyUIConnected = false;
            wsConnection = null;
            setTimeout(connectToComfyWS, 5000);
        });
        
        ws.on('error', (err) => {
            console.error('[Servidor] Erro no WebSocket:', err.message);
            isComfyUIConnected = false;
        });

    } catch (error) {
        console.error('[Servidor] Falha ao iniciar WebSocket:', error.message);
        setTimeout(connectToComfyWS, 5000);
    }
}

connectToComfyWS();

// --- API ROUTES ---

// Config Endpoint: Ler URL atual
app.get('/api/config', (req, res) => {
    res.json({ url: COMFY_API_URL });
});

// Config Endpoint: Atualizar URL
app.post('/api/config', (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "URL inválida" });

    // Atualiza variaveis globais
    COMFY_API_URL = url.replace(/\/$/, ""); // Remove barra final se houver
    
    // Deriva WS URL (http -> ws, https -> wss)
    if (COMFY_API_URL.startsWith("https")) {
        COMFY_WS_URL = COMFY_API_URL.replace("https://", "wss://") + "/ws";
    } else {
        COMFY_WS_URL = COMFY_API_URL.replace("http://", "ws://") + "/ws";
    }

    console.log(`[Config] URLs alteradas para: API=${COMFY_API_URL}, WS=${COMFY_WS_URL}`);

    // Força reconexão WebSocket
    connectToComfyWS();

    res.json({ success: true, api: COMFY_API_URL, ws: COMFY_WS_URL });
});

app.get('/api/status', (req, res) => {
    res.json({ connected: isComfyUIConnected });
});

// 1. Gerar
app.post('/api/generate', async (req, res) => {
    try {
        const { prompt, metadata } = req.body;
        
        console.log('[API] Solicitando geração...');
        const response = await axios.post(`${COMFY_API_URL}/prompt`, {
            client_id: "server_node_manager",
            prompt: prompt
        });

        const promptId = response.data.prompt_id;
        console.log(`[API] Geração iniciada com ID: ${promptId}`);
        
        activeJobs.set(promptId, { 
            id: promptId, 
            status: 'pending', 
            progress: 0,
            startTime: Date.now(),
            metadata: metadata || {} 
        });

        res.json({ success: true, prompt_id: promptId });
    } catch (error) {
        console.error("Erro ao solicitar geração:", error.message);
        res.status(500).json({ error: "Erro no ComfyUI", details: error.message });
    }
});

// 2. Fila
app.get('/api/queue', (req, res) => {
    const queue = Array.from(activeJobs.values()).sort((a, b) => b.startTime - a.startTime);
    res.json(queue);
});

// 3. Galeria
app.get('/api/gallery', (req, res) => {
    fs.readdir(GALLERY_DIR, (err, files) => {
        if (err) return res.json([]);
        
        const images = files
            .filter(f => f.toLowerCase().endsWith('.png'))
            .map(f => {
                const filePath = path.join(GALLERY_DIR, f);
                let meta = {};
                try {
                    const jsonPath = path.join(GALLERY_DIR, f.replace('.png', '.json'));
                    if (fs.existsSync(jsonPath)) {
                        const rawData = fs.readFileSync(jsonPath, 'utf-8');
                        meta = JSON.parse(rawData);
                    }
                } catch (e) {}

                let fileStats;
                try {
                    fileStats = fs.statSync(filePath);
                } catch(e) { return null; }

                return {
                    filename: f,
                    url: `/gallery/${f}`,
                    time: fileStats.mtime.getTime(),
                    ...meta 
                };
            })
            .filter(item => item !== null) // Remove nulos caso erro no stat
            .sort((a, b) => b.time - a.time);
            
        res.json(images);
    });
});

// 4. Deletar Único
app.delete('/api/image/:filename', (req, res) => {
    const filename = req.params.filename;
    // Validação básica de segurança de path traversal
    if (filename.includes('..') || filename.includes('/')) return res.status(400).json({error: 'Invalid filename'});

    const pngPath = path.join(GALLERY_DIR, filename);
    const jsonPath = path.join(GALLERY_DIR, filename.replace('.png', '.json'));

    try {
        if (fs.existsSync(pngPath)) fs.unlinkSync(pngPath);
        if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: "Erro ao excluir arquivo" });
    }
});

// 5. Deletar em Lote
app.post('/api/image/batch-delete', (req, res) => {
    const { filenames } = req.body;
    if (!Array.isArray(filenames)) return res.status(400).json({ error: "Lista inválida" });

    let deletedCount = 0;
    
    filenames.forEach(filename => {
        if (filename.includes('..') || filename.includes('/')) return; // Segurança

        const pngPath = path.join(GALLERY_DIR, filename);
        const jsonPath = path.join(GALLERY_DIR, filename.replace('.png', '.json'));
        
        try {
            if (fs.existsSync(pngPath)) {
                fs.unlinkSync(pngPath);
                deletedCount++;
            }
            if (fs.existsSync(jsonPath)) {
                fs.unlinkSync(jsonPath);
            }
        } catch (e) {
            console.error(`Falha ao deletar ${filename}:`, e.message);
        }
    });

    res.json({ success: true, count: deletedCount });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor NodeStation rodando em http://localhost:${PORT}`);
});
