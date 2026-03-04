const hamburgerBtn = document.getElementById('hamburger-icon-btn');
const mobileMenuContainer = document.getElementById('mobile-menu-container');
const closeBtn = document.getElementById('mobile-menu-close');
const mobileMenuButtons = document.querySelectorAll('.mobile-menu-button');

document.addEventListener('DOMContentLoaded', () => {
  const greetingH1 = document.getElementById('greeting-h1');
  const greetingP = document.getElementById('greeting-p');
  const greetingButtons = document.getElementById('hero-greeting-buttons');
  if (greetingH1) greetingH1.style.opacity = '1';
  setInterval(() => {
    if (greetingP) greetingP.style.opacity = '1';
  }, 500);
  setInterval(() => {
    if (greetingButtons) greetingButtons.style.opacity = '1';
  }, 700);
});

if (hamburgerBtn && mobileMenuContainer && closeBtn) {
  hamburgerBtn.addEventListener('click', () => {
    mobileMenuContainer.classList.add('active');
    document.body.style.overflow = 'hidden';
  });

  closeBtn.addEventListener('click', () => {
    mobileMenuContainer.classList.remove('active');
    document.body.style.overflow = '';
  });

  mobileMenuButtons.forEach(button => {
    button.addEventListener('click', () => {
      mobileMenuContainer.classList.remove('active');
      document.body.style.overflow = '';
    });
  });
}

const fadeElements = document.querySelectorAll('.fade-in');

const observer = new IntersectionObserver((entries, observer) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  })
}, { threshold: 0 });

fadeElements.forEach(element => observer.observe(element));

const faqQuestions = document.querySelectorAll('.faq-question');

faqQuestions.forEach(question => {
  question.addEventListener('click', () => {
    faqQuestions.forEach(q => {
      if (q !== question) {
        q.nextElementSibling.classList.remove('active');
        q.classList.remove('active');
      }
    });
    const faqAnswer = question.nextElementSibling;
    faqAnswer.classList.toggle('active');
    question.classList.toggle('active');
  });
});

