const API_BASE = window.location.origin;

const els = {
    statusIndicator: document.getElementById('connectionStatus'),
    generateBtn: document.getElementById('generateBtn'),
    positivePrompt: document.getElementById('positivePrompt'),
    negativePrompt: document.getElementById('negativePrompt'),
    widthInput: document.getElementById('widthInput'),
    heightInput: document.getElementById('heightInput'),
    
    // Controle de Upscale
    upscaleInput: document.getElementById('upscaleInput'),
    upscaleValueDisplay: document.getElementById('upscaleValueDisplay'),

    seedInput: document.getElementById('seedInput'),
    randomSeedBtn: document.getElementById('randomSeedBtn'),
    resultImage: document.getElementById('resultImage'),
    placeholder: document.getElementById('placeholder'),
    progressOverlay: document.getElementById('progressOverlay'),
    progressBar: document.getElementById('progressBar'),
    progressText: document.getElementById('progressText'),
    galleryGrid: document.getElementById('galleryGrid'),
    imageActions: document.getElementById('imageActions'),
    closeImgBtn: document.getElementById('closeImgBtn'),
    deleteImgBtn: document.getElementById('deleteImgBtn'),
    infoImgBtn: document.getElementById('infoImgBtn'), 
    queueList: document.getElementById('queueList'),
    toggleSelectModeBtn: document.getElementById('toggleSelectModeBtn'),
    deleteBatchBtn: document.getElementById('deleteBatchBtn'),
    selectedCount: document.getElementById('selectedCount'),
    
    // Configurações
    settingsBtn: document.getElementById('settingsBtn'),
    settingsModal: document.getElementById('settingsModal'),
    closeSettingsBtn: document.getElementById('closeSettingsBtn'),
    cancelSettingsAction: document.getElementById('cancelSettingsAction'),
    saveSettingsBtn: document.getElementById('saveSettingsBtn'),
    comfyUrlInput: document.getElementById('comfyUrlInput'),
    serverAddressDisplay: document.getElementById('serverAddressDisplay')
};

// Estado da Aplicação
let lastGallerySignature = '';
let currentImageData = null; 
let isSelectionMode = false;
let selectedImages = new Set(); 

// Tratamento de Erro Global
window.onerror = function(message, source, lineno, colno, error) {
    Swal.fire({
        icon: 'error',
        title: 'Erro Inesperado',
        text: message,
        footer: '<small>Verifique o console para mais detalhes.</small>',
        background: '#1e1e1e',
        color: '#fff'
    });
    return false;
};

// --- Inicialização ---
function init() {
    setupEventListeners();
    
    checkConnection();
    updateGallery(); 
    updateQueue();
    fetchConfig(); // Pega a config atual ao iniciar

    // Polling a cada 1 segundo
    setInterval(() => {
        checkConnection();
        updateQueue();
        if (!isSelectionMode) { 
            updateGallery(); 
        }
    }, 1000);
}

// --- Configurações & Conexão ---
async function fetchConfig() {
    try {
        const res = await fetch(`${API_BASE}/api/config`);
        if (res.ok) {
            const data = await res.json();
            els.comfyUrlInput.value = data.url;
            els.serverAddressDisplay.innerText = `Conectado a ${data.url}`;
        }
    } catch (e) { console.error("Falha ao buscar config", e); }
}

async function saveConfig() {
    const newUrl = els.comfyUrlInput.value.trim();
    if (!newUrl) return;

    try {
        const res = await fetch(`${API_BASE}/api/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: newUrl })
        });
        
        if (res.ok) {
            const data = await res.json();
            els.serverAddressDisplay.innerText = `Conectado a ${data.api}`;
            closeSettings();
            Swal.fire({
                icon: 'success',
                title: 'Conexão Atualizada',
                text: 'URL do servidor alterada com sucesso.',
                timer: 1500,
                showConfirmButton: false,
                background: '#1e1e1e', color: '#fff'
            });
            checkConnection(); // Força re-check
        } else {
            throw new Error('Falha na resposta do servidor');
        }
    } catch (e) {
        Swal.fire({
            icon: 'error',
            title: 'Erro',
            text: 'Não foi possível salvar a configuração.',
            background: '#1e1e1e', color: '#fff'
        });
    }
}

async function checkConnection() {
    try {
        const res = await fetch(`${API_BASE}/api/status`);
        if (res.ok) {
            const data = await res.json();
            setOnlineStatus(data.connected);
        } else {
            setOnlineStatus(false);
        }
    } catch (e) {
        setOnlineStatus(false);
    }
}

function setOnlineStatus(isOnline) {
    if (isOnline) {
        els.statusIndicator.classList.add('online');
        els.statusIndicator.title = "ComfyUI Conectado";
        if (!els.generateBtn.hasAttribute('data-clicked')) {
            els.generateBtn.disabled = false;
        }
    } else {
        els.statusIndicator.classList.remove('online');
        els.statusIndicator.title = "ComfyUI Desconectado ou Erro no Servidor";
        els.generateBtn.disabled = true;
    }
}

// --- Funções de UI Auxiliares ---
function openSettings() {
    fetchConfig(); // Garante que está atualizado ao abrir
    els.settingsModal.classList.remove('hidden');
}

function closeSettings() {
    els.settingsModal.classList.add('hidden');
}

function toggleSeedInput() {
    if (els.randomSeedBtn.checked) {
        els.seedInput.disabled = true;
        els.seedInput.value = '';
        els.seedInput.placeholder = "Aleatório";
    } else {
        els.seedInput.disabled = false;
        els.seedInput.placeholder = "Digite a seed...";
        els.seedInput.focus();
    }
}

function updateUpscaleDisplay() {
    const val = els.upscaleInput.value;
    els.upscaleValueDisplay.innerText = `${val}x`;
}

// --- ATUALIZAÇÃO DA GALERIA ---
async function updateGallery() {
    try {
        const response = await fetch(`${API_BASE}/api/gallery`);
        const images = await response.json();
        
        const newSignature = JSON.stringify(images.map(img => img.filename));
        if (newSignature === lastGallerySignature) return;

        lastGallerySignature = newSignature;
        renderGalleryGrid(images);

    } catch (e) { 
        console.error("Erro ao atualizar galeria", e); 
    }
}

function renderGalleryGrid(images) {
    els.galleryGrid.innerHTML = ''; 
    
    if (images.length === 0) {
        els.galleryGrid.innerHTML = '<p style="color:#666; width:100%; text-align:center; padding: 20px;">Sem imagens</p>';
        return;
    }

    images.forEach(imgData => {
        addToGallery(imgData);
    });
}

function addToGallery(imgData) {
    const div = document.createElement('div');
    div.className = 'gallery-item';
    div.dataset.filename = imgData.filename;
    
    if (selectedImages.has(imgData.filename)) {
        div.classList.add('selected');
    }

    const img = document.createElement('img');
    img.src = imgData.url;
    img.loading = "lazy";
    
    div.onclick = () => {
        if (isSelectionMode) {
            toggleSelection(div, imgData.filename);
        } else {
            displayImage(imgData);
        }
    };
    
    div.appendChild(img);
    els.galleryGrid.appendChild(div);
}

// --- LÓGICA DE SELEÇÃO E EXCLUSÃO EM LOTE ---
function toggleSelectionMode() {
    isSelectionMode = !isSelectionMode;
    selectedImages.clear();
    updateSelectionUI();
    
    if (isSelectionMode) {
        els.toggleSelectModeBtn.innerHTML = '<span class="material-icons" style="font-size: 1.1rem; vertical-align: middle;">close</span> Cancelar';
        els.toggleSelectModeBtn.style.color = 'var(--text-main)';
    } else {
        els.toggleSelectModeBtn.innerHTML = '<span class="material-icons" style="font-size: 1.1rem; vertical-align: middle;">check_box</span> Selecionar';
        els.toggleSelectModeBtn.style.color = '';
        document.querySelectorAll('.gallery-item.selected').forEach(el => el.classList.remove('selected'));
        lastGallerySignature = ""; 
        updateGallery();
    }
}

function toggleSelection(element, filename) {
    if (selectedImages.has(filename)) {
        selectedImages.delete(filename);
        element.classList.remove('selected');
    } else {
        selectedImages.add(filename);
        element.classList.add('selected');
    }
    updateSelectionUI();
}

function updateSelectionUI() {
    els.selectedCount.innerText = selectedImages.size;
    if (selectedImages.size > 0) {
        els.deleteBatchBtn.classList.remove('hidden');
    } else {
        els.deleteBatchBtn.classList.add('hidden');
    }
}

async function deleteBatchImages() {
    if (selectedImages.size === 0) return;

    const result = await Swal.fire({
        title: 'Tem certeza?',
        text: `Você vai excluir ${selectedImages.size} imagens permanentemente!`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'Sim, excluir!',
        cancelButtonText: 'Cancelar',
        background: '#1e1e1e',
        color: '#fff'
    });

    if (result.isConfirmed) {
        try {
            await fetch(`${API_BASE}/api/image/batch-delete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filenames: Array.from(selectedImages) })
            });

            Swal.fire({
                title: 'Excluído!',
                text: 'As imagens foram removidas.',
                icon: 'success',
                timer: 1500,
                showConfirmButton: false,
                background: '#1e1e1e', color: '#fff'
            });

            toggleSelectionMode();
            lastGallerySignature = "";
            updateGallery();

        } catch (e) {
            Swal.fire({
                icon: 'error',
                title: 'Erro',
                text: 'Falha ao excluir imagens.',
                background: '#1e1e1e', color: '#fff'
            });
        }
    }
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
            item.title = "Clique para visualizar";
            const meta = { 
                url: job.outputUrl, 
                filename: job.filename,
                positive: job.metadata?.positive,
                negative: job.metadata?.negative,
                seed: job.metadata?.seed,
                width: job.metadata?.width,
                height: job.metadata?.height
            };
            item.onclick = () => displayImage(meta);
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

// --- GERAÇÃO DE IMAGEM ---
els.generateBtn.addEventListener('click', async () => {
    if(!els.positivePrompt.value.trim()) {
        Swal.fire({ icon: 'warning', title: 'Atenção', text: 'O prompt positivo não pode estar vazio.', background: '#1e1e1e', color: '#fff' });
        return;
    }

    els.generateBtn.disabled = true;
    els.generateBtn.setAttribute('data-clicked', 'true');
    setTimeout(() => {
        els.generateBtn.disabled = false;
        els.generateBtn.removeAttribute('data-clicked');
    }, 1000);

    // LÓGICA DE SEED
    let seed;
    if (els.randomSeedBtn.checked) {
        seed = Math.floor(Math.random() * 10000000000);
    } else {
        seed = parseInt(els.seedInput.value);
        if (isNaN(seed)) {
            seed = Math.floor(Math.random() * 10000000000);
        }
    }

    // LÓGICA DE UPSCALE (ATUALIZADA PARA FLOAT)
    const upscaleLevel = parseFloat(els.upscaleInput.value); // Lê o valor como float (ex: 1.5, 2.5)
    const scaleBy = upscaleLevel / 4; // Mapeia 1->0.25, 4->1.0

    const width = parseInt(els.widthInput.value) || 1024;
    const height = parseInt(els.heightInput.value) || 1024;
    const positive = els.positivePrompt.value;
    const negative = els.negativePrompt.value;

    const promptFlow = {
        "1": { "inputs": { "ckpt_name": "WAI_NFSW.safetensors" }, "class_type": "CheckpointLoaderSimple" },
        "8": { "inputs": { "clip": ["1", 1], "stop_at_clip_layer": -2 }, "class_type": "CLIPSetLastLayer" },
        "9": { "inputs": { "text": positive, "clip": ["8", 0] }, "class_type": "CLIPTextEncode" },
        "7": { "inputs": { "text": negative, "clip": ["8", 0] }, "class_type": "CLIPTextEncode" },
        "3": { "inputs": { "width": width, "height": height, "batch_size": 1 }, "class_type": "EmptyLatentImage" },
        "10": { "inputs": { "model_name": "RealESRGAN_x4plus_anime_6B.pth" }, "class_type": "UpscaleModelLoader" },
        "2": { "inputs": { "model": ["1", 0], "positive": ["9", 0], "negative": ["7", 0], "latent_image": ["3", 0], "seed": seed, "steps": 30, "cfg": 7, "sampler_name": "euler_ancestral", "scheduler": "simple", "denoise": 1 }, "class_type": "KSampler" },
        "4": { "inputs": { "samples": ["2", 0], "vae": ["1", 2], "tile_size": 512, "overlap": 64, "temporal_size": 64, "temporal_overlap": 8 }, "class_type": "VAEDecodeTiled" },
        "11": { "inputs": { "upscale_model": ["10", 0], "image": ["4", 0] }, "class_type": "ImageUpscaleWithModel" },
        
        // Nó Atualizado com o scale_by dinâmico
        "12": { "inputs": { "image": ["11", 0], "upscale_method": "nearest-exact", "scale_by": scaleBy }, "class_type": "ImageScaleBy" },
        
        "5": { "inputs": { "pixels": ["12", 0], "vae": ["1", 2], "tile_size": 512, "overlap": 64, "temporal_size": 64, "temporal_overlap": 8 }, "class_type": "VAEEncodeTiled" },
        "13": { "inputs": { "model": ["1", 0], "positive": ["9", 0], "negative": ["7", 0], "latent_image": ["5", 0], "seed": seed, "steps": 20, "cfg": 7, "sampler_name": "euler_ancestral", "scheduler": "simple", "denoise": 0.5 }, "class_type": "KSampler" },
        "14": { "inputs": { "samples": ["13", 0], "vae": ["1", 2], "tile_size": 512, "overlap": 64, "temporal_size": 64, "temporal_overlap": 8 }, "class_type": "VAEDecodeTiled" },
        "15": { "inputs": { "images": ["14", 0] }, "class_type": "SaveImageWebsocket" }
    };

    const metadata = { positive, negative, seed, width, height, upscale: upscaleLevel };

    try {
        await fetch(`${API_BASE}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: promptFlow, metadata: metadata })
        });
        updateQueue(); 
        
        const toast = Swal.mixin({
            toast: true, position: 'top-end', showConfirmButton: false, timer: 3000, timerProgressBar: true, background: '#1e1e1e', color: '#fff'
        });
        toast.fire({ icon: 'success', title: 'Adicionado à fila!' });

    } catch (error) {
        Swal.fire({
            icon: 'error', title: 'Erro de Conexão', text: error.message, background: '#1e1e1e', color: '#fff'
        });
    }
});

// --- Visualização de Imagem ---
function displayImage(imgData) {
    currentImageData = imgData; 
    els.resultImage.src = imgData.url;
    els.resultImage.classList.remove('hidden');
    els.imageActions.classList.remove('hidden');
    els.placeholder.classList.add('hidden');
}

function closeImage() {
    els.resultImage.classList.add('hidden');
    els.imageActions.classList.add('hidden');
    els.placeholder.classList.remove('hidden');
    els.resultImage.src = '';
    currentImageData = null;
}

function showImageMetadata() {
    if (!currentImageData) return;
    const positive = currentImageData.positive || "Não disponível";
    const negative = currentImageData.negative || "Não disponível";
    const seed = currentImageData.seed || "Desconhecido";
    const dims = (currentImageData.width && currentImageData.height) ? `${currentImageData.width}x${currentImageData.height}` : "Desconhecido";
    const upscale = currentImageData.upscale ? `${currentImageData.upscale}x` : "Padrão";

    Swal.fire({
        title: '<strong>Metadados da Imagem</strong>',
        html: `
            <div style="text-align: left; font-size: 0.9rem; color: #e0e0e0;">
                <p><strong style="color: #bb86fc;">Seed:</strong> ${seed}</p>
                <p><strong style="color: #bb86fc;">Dimensões:</strong> ${dims}</p>
                <p><strong style="color: #bb86fc;">Upscale:</strong> ${upscale}</p>
                <hr style="border-color: #333; margin: 10px 0;">
                <p><strong style="color: #03dac6;">Positivo:</strong><br><span style="font-size:0.85rem; color: #ccc;">${positive}</span></p>
                <div style="margin-top:10px;"></div>
                <p><strong style="color: #cf6679;">Negativo:</strong><br><span style="font-size:0.85rem; color: #ccc;">${negative}</span></p>
            </div>
        `,
        background: '#1e1e1e', color: '#fff', showCloseButton: true, focusConfirm: false, confirmButtonText: 'Fechar', confirmButtonColor: '#bb86fc'
    });
}

// --- Event Listeners ---
function setupEventListeners() {
    els.closeImgBtn.addEventListener('click', closeImage);
    els.infoImgBtn.addEventListener('click', showImageMetadata);
    els.toggleSelectModeBtn.addEventListener('click', toggleSelectionMode);
    els.deleteBatchBtn.addEventListener('click', deleteBatchImages);
    
    // Configurações
    els.settingsBtn.addEventListener('click', openSettings);
    els.closeSettingsBtn.addEventListener('click', closeSettings);
    els.cancelSettingsAction.addEventListener('click', closeSettings);
    els.saveSettingsBtn.addEventListener('click', saveConfig);

    // Seed
    els.randomSeedBtn.addEventListener('change', toggleSeedInput);

    // Upscale
    els.upscaleInput.addEventListener('input', updateUpscaleDisplay);

    // Deletar Único
    els.deleteImgBtn.addEventListener('click', async () => {
        if (!currentImageData || !currentImageData.filename) return;
        const result = await Swal.fire({
            title: 'Excluir imagem?', text: "Você não poderá reverter isso!", icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', cancelButtonColor: '#3085d6', confirmButtonText: 'Sim, excluir!', cancelButtonText: 'Cancelar', background: '#1e1e1e', color: '#fff'
        });
        if (result.isConfirmed) {
            try {
                await fetch(`${API_BASE}/api/image/${currentImageData.filename}`, { method: 'DELETE' });
                Swal.fire({ title: 'Excluído!', text: 'A imagem foi removida.', icon: 'success', timer: 1500, showConfirmButton: false, background: '#1e1e1e', color: '#fff' });
                lastGallerySignature = ""; 
                updateGallery(); 
                closeImage();
            } catch (e) {
                Swal.fire({ icon: 'error', title: 'Erro', text: 'Não foi possível excluir.', background: '#1e1e1e', color: '#fff' });
            }
        }
    });
}

init();