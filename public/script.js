const API_BASE = window.location.origin;

const els = {
    statusIndicator: document.getElementById('connectionStatus'),
    generateBtn: document.getElementById('generateBtn'),
    positivePrompt: document.getElementById('positivePrompt'),
    negativePrompt: document.getElementById('negativePrompt'),
    widthInput: document.getElementById('widthInput'),
    heightInput: document.getElementById('heightInput'),
    resultImage: document.getElementById('resultImage'),
    placeholder: document.getElementById('placeholder'),
    progressOverlay: document.getElementById('progressOverlay'),
    progressBar: document.getElementById('progressBar'),
    progressText: document.getElementById('progressText'),
    galleryGrid: document.getElementById('galleryGrid'),
    imageActions: document.getElementById('imageActions'),
    closeImgBtn: document.getElementById('closeImgBtn'),
    deleteImgBtn: document.getElementById('deleteImgBtn'),
    queueList: document.getElementById('queueList')
};

// Variável para armazenar o "estado" anterior da galeria e evitar recargas desnecessárias
let lastGallerySignature = '';

// --- Inicialização ---
function init() {
    setupEventListeners();
    
    // Executa imediatamente ao abrir
    checkConnection();
    updateGallery(); 
    updateQueue();

    // Loop principal (Polling) - Atualiza Status, Fila e Galeria a cada 1 segundo
    setInterval(() => {
        checkConnection();
        updateQueue();
        updateGallery(); // Agora a galeria é verificada constantemente
    }, 1000);
}

// --- Status do Servidor ---
async function checkConnection() {
    try {
        const res = await fetch(`${API_BASE}/api/gallery`, { method: 'HEAD' });
        setOnlineStatus(res.ok);
    } catch (e) {
        setOnlineStatus(false);
    }
}

function setOnlineStatus(isOnline) {
    if (isOnline) {
        els.statusIndicator.classList.add('online');
        els.statusIndicator.title = "Servidor Online";
        // Só habilita o botão se não houver delay de clique
        if (!els.generateBtn.hasAttribute('data-clicked')) {
            els.generateBtn.disabled = false;
        }
    } else {
        els.statusIndicator.classList.remove('online');
        els.statusIndicator.title = "Servidor Offline";
        els.generateBtn.disabled = true;
    }
}

// --- ATUALIZAÇÃO DA GALERIA (AUTO-REFRESH) ---
async function updateGallery() {
    try {
        const response = await fetch(`${API_BASE}/api/gallery`);
        const images = await response.json();
        
        // Cria uma "assinatura" da lista atual (ex: nomes dos arquivos juntos)
        // Isso serve para saber se algo mudou antes de mexer no HTML
        const newSignature = JSON.stringify(images.map(img => img.filename));

        // Se a assinatura for igual à última vez, NÃO FAZ NADA (evita piscar a tela)
        if (newSignature === lastGallerySignature) return;

        // Se mudou, atualiza a assinatura e renderiza
        lastGallerySignature = newSignature;
        renderGalleryGrid(images);

    } catch (e) { 
        console.error("Erro ao atualizar galeria", e); 
    }
}

function renderGalleryGrid(images) {
    els.galleryGrid.innerHTML = ''; // Limpa
    
    if (images.length === 0) {
        els.galleryGrid.innerHTML = '<p style="color:#666; width:100%; text-align:center;">Sem imagens</p>';
        return;
    }

    images.forEach(imgData => {
        addToGallery(imgData.url, imgData.filename);
    });
}

function addToGallery(url, filename) {
    const div = document.createElement('div');
    div.className = 'gallery-item';
    
    const img = document.createElement('img');
    img.src = url;
    img.loading = "lazy"; // Importante para performance
    
    div.onclick = () => {
        displayImage(url);
        els.deleteImgBtn.dataset.currentFile = filename;
    };
    
    div.appendChild(img);
    els.galleryGrid.appendChild(div);
}

// --- ATUALIZAÇÃO DA FILA ---
async function updateQueue() {
    try {
        const res = await fetch(`${API_BASE}/api/queue`);
        if (!res.ok) return;
        const queue = await res.json();
        renderQueue(queue);
    } catch (e) {
        console.error("Erro ao buscar fila", e);
    }
}

function renderQueue(queueData) {
    els.queueList.innerHTML = '';

    if (queueData.length === 0) {
        els.queueList.innerHTML = '<div style="color:var(--text-muted); padding:10px; text-align:center; font-size:0.8rem;">Fila vazia</div>';
        // Esconde overlay se não tiver nada
        els.progressOverlay.classList.add('hidden');
        return;
    }

    let somethingProcessing = false;

    queueData.forEach(job => {
        const item = document.createElement('div');
        item.className = `queue-item ${job.status}`;
        if (job.status === 'processing') item.classList.add('active');

        let statusText = 'Na Fila';
        if (job.status === 'processing') statusText = 'Gerando...';
        if (job.status === 'completed') statusText = 'Pronto';

        item.innerHTML = `
            <div class="queue-header">
                <span class="queue-id">Job #${job.id.substring(0,6)}</span>
                <span class="queue-status">${statusText}</span>
            </div>
            <div class="queue-mini-bar-bg">
                <div class="queue-mini-bar-fill" style="width: ${job.progress}%"></div>
            </div>
        `;

        if (job.status === 'completed' && job.outputUrl) {
            item.style.cursor = 'pointer';
            item.onclick = () => displayImage(job.outputUrl);
        }

        if (job.status === 'processing') {
            somethingProcessing = true;
            els.progressOverlay.classList.remove('hidden');
            els.progressBar.style.width = `${job.progress}%`;
            els.progressText.innerText = `${job.progress}%`;
        }

        els.queueList.appendChild(item);
    });

    if (!somethingProcessing) {
        els.progressOverlay.classList.add('hidden');
    }
}

// --- Geração ---
els.generateBtn.addEventListener('click', async () => {
    // Trava botão temporariamente
    els.generateBtn.disabled = true;
    els.generateBtn.setAttribute('data-clicked', 'true');
    setTimeout(() => {
        els.generateBtn.disabled = false;
        els.generateBtn.removeAttribute('data-clicked');
    }, 1000);

    const seed = Math.floor(Math.random() * 10000000000);
    const width = parseInt(els.widthInput.value);
    const height = parseInt(els.heightInput.value);

    // SEU WORKFLOW COMPLETO
    const promptFlow = {
        "14": { "inputs": { "clip": ["30", 1], "stop_at_clip_layer": -2 }, "class_type": "CLIPSetLastLayer" },
        "38": { "inputs": { "pixels": ["40", 0], "vae": ["30", 2], "tile_size": 512, "overlap": 64, "temporal_size": 8, "temporal_overlap": 4 }, "class_type": "VAEEncodeTiled" },
        "40": { "inputs": { "upscale_model": ["33", 0], "image": ["36", 0], "upscale_by": 1.5, "rescale_method": "nearest-exact" }, "class_type": "UpscaleImageByUsingModel" },
        "33": { "inputs": { "model_name": "RealESRGAN_x4plus_anime_6B.pth" }, "class_type": "UpscaleModelLoader" },
        "29": { "inputs": { "seed": seed, "steps": 20, "cfg": 7, "sampler_name": "euler_ancestral", "scheduler": "normal", "denoise": 0.5, "model": ["30", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["38", 0] }, "class_type": "KSampler" },
        "36": { "inputs": { "samples": ["3", 0], "vae": ["30", 2], "tile_size": 512, "overlap": 64, "temporal_size": 8, "temporal_overlap": 4 }, "class_type": "VAEDecodeTiled" },
        "39": { "inputs": { "samples": ["29", 0], "vae": ["30", 2], "tile_size": 512, "overlap": 64, "temporal_size": 8, "temporal_overlap": 4 }, "class_type": "VAEDecodeTiled" },
        "30": { "inputs": { "ckpt_name": "WAI_NFSW.safetensors" }, "class_type": "CheckpointLoaderSimple" },
        "7": { "inputs": { "text": els.negativePrompt.value, "clip": ["14", 0] }, "class_type": "CLIPTextEncode" },
        "3": { "inputs": { "seed": seed, "steps": 30, "cfg": 7, "sampler_name": "euler_ancestral", "scheduler": "normal", "denoise": 1, "model": ["30", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["5", 0] }, "class_type": "KSampler" },
        "6": { "inputs": { "text": els.positivePrompt.value, "clip": ["14", 0] }, "class_type": "CLIPTextEncode" },
        "5": { "inputs": { "width": width, "height": height, "batch_size": 1 }, "class_type": "EmptyLatentImage" },
        "100": { "inputs": { "filename_prefix": "NodeStation_Hires", "images": ["39", 0] }, "class_type": "SaveImage" }
    };

    try {
        await fetch(`${API_BASE}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: promptFlow })
        });
        updateQueue(); // Atualiza fila visualmente na hora
    } catch (error) {
        alert('Erro: ' + error.message);
    }
});

// --- Visualização de Imagem ---
function displayImage(url) {
    els.resultImage.src = url;
    els.resultImage.classList.remove('hidden');
    els.imageActions.classList.remove('hidden');
    els.placeholder.classList.add('hidden');
}

function closeImage() {
    els.resultImage.classList.add('hidden');
    els.imageActions.classList.add('hidden');
    els.placeholder.classList.remove('hidden');
    els.resultImage.src = '';
    els.deleteImgBtn.dataset.currentFile = '';
}

// --- Event Listeners ---
function setupEventListeners() {
    els.closeImgBtn.addEventListener('click', closeImage);
    
    els.deleteImgBtn.addEventListener('click', async () => {
        const filename = els.deleteImgBtn.dataset.currentFile;
        if (!filename) return;

        if(confirm("Excluir imagem permanentemente?")) {
            try {
                await fetch(`${API_BASE}/api/image/${filename}`, { method: 'DELETE' });
                
                // Força atualização manual para feedback instantâneo
                // (O loop automático pegaria depois, mas isso faz ser mais rápido)
                lastGallerySignature = ""; // Reseta assinatura para forçar redesenho
                updateGallery(); 
                
                closeImage();
            } catch (e) {
                console.error(e);
            }
        }
    });
}

// Inicia aplicação
init();