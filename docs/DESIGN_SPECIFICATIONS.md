# Sabalan ERP - Design Specifications

## 🎨 Design Philosophy

**Design Approach**: Luxury Glass Morphism with Persian/Farsi Interface  
**Target Audience**: Iranian Stone Industry Professionals  
**Brand Positioning**: Premium, Sophisticated, Modern  
**Design Inspiration**: Apple Glass Liquid Design + Subtle Glass Morphism  
**Language**: 100% Persian/Farsi with complete RTL support  
**Default Theme**: Dark mode with Silver as primary color  

---

## 🌙 Theme System

### Color Palette

#### **Primary Colors** (Silver as Primary)
- **Silver**: `#C0C0C0` (Light) / `#808080` (Dark) - **PRIMARY**
- **Gold**: `#FFD700` (Light) / `#B8860B` (Dark) - Secondary
- **Purple**: `#8A2BE2` (Light) / `#4B0082` (Dark) - Accent

#### **Light Mode Colors**
```css
:root {
  --primary-silver: #C0C0C0;
  --primary-gold: #FFD700;
  --primary-purple: #8A2BE2;
  --background: #FAFAFA;
  --surface: rgba(255, 255, 255, 0.8);
  --text-primary: #1A1A1A;
  --text-secondary: #4A4A4A;
  --border: rgba(192, 192, 192, 0.3);
  --shadow: rgba(0, 0, 0, 0.1);
}
```

#### **Dark Mode Colors** (Default Theme)
```css
:root[data-theme="dark"] {
  --primary-silver: #808080;
  --primary-gold: #B8860B;
  --primary-purple: #4B0082;
  --background: #0A0A0A;
  --surface: rgba(20, 20, 20, 0.8);
  --text-primary: #FFFFFF;
  --text-secondary: #B0B0B0;
  --border: rgba(128, 128, 128, 0.3);
  --shadow: rgba(0, 0, 0, 0.3);
}
```

#### **Apple Glass Liquid Design Elements**
- **Fluid Animations**: Smooth, liquid-like transitions
- **Dynamic Blur**: Adaptive backdrop blur effects
- **Layered Glass**: Multiple glass layers with depth
- **Subtle Reflections**: Minimal light reflections
- **Organic Shapes**: Rounded, flowing component shapes

---

## 🪟 Glass Morphism Design

### **Core Principles** (Subtle Glass Effects)
- **Transparency**: Semi-transparent backgrounds (subtle)
- **Blur Effects**: Backdrop blur for depth (moderate)
- **Subtle Borders**: Minimal border styling
- **Layered Depth**: Multiple glass layers
- **Soft Shadows**: Gentle shadow effects
- **Apple-Inspired**: Fluid, liquid-like animations
- **Mobile-First**: Creative mobile-first design approach

### **Glass Morphism Components**

#### **Primary Glass Card**
```css
.glass-card {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
}
```

#### **Secondary Glass Panel**
```css
.glass-panel {
  background: rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(15px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.05);
}
```

#### **Glass Button**
```css
.glass-button {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  transition: all 0.3s ease;
}

.glass-button:hover {
  background: rgba(255, 255, 255, 0.2);
  transform: translateY(-2px);
  box-shadow: 0 8px 25px rgba(0, 0, 0, 0.15);
}
```

---

## 🔤 Typography (Persian/Farsi)

### **Font Selection**
- **Primary Font**: Vazir (Persian-optimized)
- **Secondary Font**: Samim (Persian-optimized)
- **Fallback**: Tahoma, Arial, sans-serif

### **Font Weights**
- **Light**: 300
- **Regular**: 400
- **Medium**: 500
- **Bold**: 700
- **Extra Bold**: 800

### **Typography Scale**
```css
.text-xs { font-size: 0.75rem; line-height: 1rem; }
.text-sm { font-size: 0.875rem; line-height: 1.25rem; }
.text-base { font-size: 1rem; line-height: 1.5rem; }
.text-lg { font-size: 1.125rem; line-height: 1.75rem; }
.text-xl { font-size: 1.25rem; line-height: 1.75rem; }
.text-2xl { font-size: 1.5rem; line-height: 2rem; }
.text-3xl { font-size: 1.875rem; line-height: 2.25rem; }
.text-4xl { font-size: 2.25rem; line-height: 2.5rem; }
```

---

## 🎯 Component Design System

### **Buttons**

#### **Primary Button**
```css
.btn-primary {
  background: linear-gradient(135deg, var(--primary-gold), var(--primary-purple));
  color: white;
  border: none;
  border-radius: 12px;
  padding: 12px 24px;
  font-weight: 500;
  transition: all 0.3s ease;
  box-shadow: 0 4px 15px rgba(255, 215, 0, 0.3);
}

.btn-primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 25px rgba(255, 215, 0, 0.4);
}
```

#### **Glass Button**
```css
.btn-glass {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: var(--text-primary);
  border-radius: 12px;
  padding: 12px 24px;
  font-weight: 500;
  transition: all 0.3s ease;
}
```

### **Cards**

#### **Dashboard Card**
```css
.dashboard-card {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(15px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 20px;
  padding: 24px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
  transition: all 0.3s ease;
}

.dashboard-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.15);
}
```

### **Forms**

#### **Input Fields**
```css
.input-field {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 12px;
  padding: 12px 16px;
  color: var(--text-primary);
  transition: all 0.3s ease;
}

.input-field:focus {
  border-color: var(--primary-gold);
  box-shadow: 0 0 0 3px rgba(255, 215, 0, 0.1);
  outline: none;
}
```

---

## 📱 Responsive Design

### **Breakpoints**
- **Mobile**: 320px - 768px
- **Tablet**: 768px - 1024px
- **Desktop**: 1024px - 1440px
- **Large Desktop**: 1440px+

### **Mobile-First Approach**
```css
/* Mobile First */
.component {
  /* Mobile styles */
}

@media (min-width: 768px) {
  .component {
    /* Tablet styles */
  }
}

@media (min-width: 1024px) {
  .component {
    /* Desktop styles */
  }
}
```

---

## 🌐 Persian/Farsi Internationalization

### **RTL Support**
- **Direction**: Right-to-left (RTL) layout
- **Text Alignment**: Right-aligned text
- **Icons**: Mirrored for RTL context
- **Navigation**: Right-to-left navigation flow

### **Language Configuration** (100% Persian/Farsi)
```javascript
// next.config.js
const nextConfig = {
  i18n: {
    locales: ['fa'],
    defaultLocale: 'fa',
    localeDetection: false,
  },
}
```

### **Translation Structure**
```json
{
  "common": {
    "dashboard": "داشبورد",
    "users": "کاربران",
    "settings": "تنظیمات",
    "logout": "خروج"
  },
  "departments": {
    "security": "انتظامات",
    "finance": "مالی و حساب داری",
    "warehouse": "انبار",
    "sales": "فروش و بازاریابی",
    "production": "کارگاه",
    "customer": "امور مشتریان"
  }
}
```

---

## 🎨 Animation & Transitions

### **Transition Timing**
- **Fast**: 0.15s ease
- **Normal**: 0.3s ease
- **Slow**: 0.5s ease

### **Hover Effects**
```css
.hover-lift {
  transition: transform 0.3s ease, box-shadow 0.3s ease;
}

.hover-lift:hover {
  transform: translateY(-4px);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.15);
}
```

### **Loading Animations**
```css
@keyframes shimmer {
  0% { background-position: -200px 0; }
  100% { background-position: calc(200px + 100%) 0; }
}

.loading-shimmer {
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
  background-size: 200px 100%;
  animation: shimmer 1.5s infinite;
}
```

---

## 🎯 Accessibility

### **WCAG Compliance**
- **Color Contrast**: Minimum 4.5:1 ratio
- **Keyboard Navigation**: Full keyboard support
- **Screen Readers**: Proper ARIA labels
- **Focus Indicators**: Clear focus states

### **Persian/Farsi Accessibility**
- **RTL Support**: Proper right-to-left layout
- **Font Size**: Minimum 14px for readability
- **Line Height**: 1.5x for comfortable reading
- **Spacing**: Adequate spacing between elements

---

## 🚀 Implementation Guidelines

### **CSS Architecture**
```css
/* Base styles */
@import 'tailwindcss/base';
@import 'tailwindcss/components';
@import 'tailwindcss/utilities';

/* Custom components */
@import './components/glass-morphism.css';
@import './components/persian-typography.css';
@import './components/theme-colors.css';
```

### **Component Structure**
```
src/
├── components/
│   ├── ui/
│   │   ├── GlassCard.tsx
│   │   ├── GlassButton.tsx
│   │   ├── GlassInput.tsx
│   │   └── GlassModal.tsx
│   ├── layout/
│   │   ├── Header.tsx
│   │   ├── Sidebar.tsx
│   │   └── Footer.tsx
│   └── theme/
│       ├── ThemeProvider.tsx
│       └── ThemeToggle.tsx
├── styles/
│   ├── globals.css
│   ├── glass-morphism.css
│   └── persian-typography.css
└── locales/
    ├── fa/
    │   └── common.json
    └── en/
        └── common.json
```

---

## 📊 Design Tokens

### **Spacing Scale**
```css
--space-1: 0.25rem;   /* 4px */
--space-2: 0.5rem;    /* 8px */
--space-3: 0.75rem;   /* 12px */
--space-4: 1rem;      /* 16px */
--space-5: 1.25rem;   /* 20px */
--space-6: 1.5rem;    /* 24px */
--space-8: 2rem;      /* 32px */
--space-10: 2.5rem;   /* 40px */
--space-12: 3rem;     /* 48px */
--space-16: 4rem;     /* 64px */
```

### **Border Radius Scale**
```css
--radius-sm: 0.25rem;   /* 4px */
--radius-md: 0.5rem;    /* 8px */
--radius-lg: 0.75rem;   /* 12px */
--radius-xl: 1rem;      /* 16px */
--radius-2xl: 1.5rem;   /* 24px */
--radius-full: 9999px;   /* Full rounded */
```

### **Shadow Scale**
```css
--shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
--shadow-md: 0 4px 6px rgba(0, 0, 0, 0.1);
--shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.1);
--shadow-xl: 0 20px 25px rgba(0, 0, 0, 0.1);
--shadow-2xl: 0 25px 50px rgba(0, 0, 0, 0.15);
```

---

*This design specification serves as the foundation for all UI/UX development activities, ensuring consistency and luxury throughout the Sabalan ERP system.*
