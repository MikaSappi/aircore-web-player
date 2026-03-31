(function() {
	const observerOptions = {
		root: null,
		rootMargin: '0px 0px -100px 0px',
		threshold: 0.1
	};

	const observer = new IntersectionObserver((entries) => {
		entries.forEach(entry => {
			if (entry.isIntersecting) {
				entry.target.classList.add('is-visible');
				// Optional: Stop observing after animation triggers
				// observer.unobserve(entry.target);
			}
		});
	}, observerOptions);

	// Observe all elements with data-animate attribute
	const animatedElements = document.querySelectorAll('[data-animate]');
	animatedElements.forEach(el => observer.observe(el));
})();
