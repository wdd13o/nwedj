// Infinite scroll observer for media grid
function setupInfiniteScroll() {
    const options = {
        root: null,
        rootMargin: '20px',
        threshold: 0.1
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && !isLoading) {
                loadMoreMedia();
            }
        });
    }, options);

    // Add sentinel element for infinite scroll
    const sentinel = document.createElement('div');
    sentinel.id = 'sentinel';
    sentinel.style.height = '1px';
    mediaGrid.appendChild(sentinel);
    observer.observe(sentinel);
}

async function loadMoreMedia() {
    if (isLoading) return;
    isLoading = true;

    try {
        currentPage++;
        const loadingIndicator = document.createElement('div');
        loadingIndicator.className = 'loading-indicator';
        loadingIndicator.textContent = 'Loading more media...';
        mediaGrid.appendChild(loadingIndicator);

        // Re-render with next page
        await renderMedia(currentMedia);

        loadingIndicator.remove();
    } catch (error) {
        console.error('Error loading more media:', error);
    } finally {
        isLoading = false;
    }
}

// Initialize infinite scroll when document is ready
document.addEventListener('DOMContentLoaded', () => {
    if (mediaGrid) {
        setupInfiniteScroll();
    }
});