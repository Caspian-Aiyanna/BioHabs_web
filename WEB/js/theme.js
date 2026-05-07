document.addEventListener('DOMContentLoaded', () => {
    const toggleBtn = document.getElementById('theme-toggle');
    const sunIcon = document.getElementById('theme-icon-sun');
    const moonIcon = document.getElementById('theme-icon-moon');
    
    // Apply saved theme on load (default to dark)
    const currentTheme = localStorage.getItem('theme') || 'dark';
    
    function updateIcons(theme) {
        if (theme === 'light') {
            if(sunIcon) sunIcon.style.display = 'block';
            if(moonIcon) moonIcon.style.display = 'none';
        } else {
            if(sunIcon) sunIcon.style.display = 'none';
            if(moonIcon) moonIcon.style.display = 'block';
        }
    }

    // Apply initially
    updateIcons(currentTheme);

    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            document.body.classList.toggle('light-theme');
            const isLight = document.body.classList.contains('light-theme');
            const newTheme = isLight ? 'light' : 'dark';
            localStorage.setItem('theme', newTheme);
            updateIcons(newTheme);
        });
    }
});
