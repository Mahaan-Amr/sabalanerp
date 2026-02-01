# Product Catalog Analysis - kala-kod.xls

## 📊 Excel File Analysis

### File Structure
- **File**: `excel/kala-kod.xls`
- **Sheet**: Sheet3
- **Total Rows**: 103
- **Data Rows**: 102 (excluding header)

### Column Structure
The Excel file contains **8 main product attributes** with corresponding codes:

1. **ابعاد برش** (Cutting Dimensions) - Codes 1-3
2. **جنس سنگ** (Stone Type) - Codes 1-12
3. **عرض سنگ** (Stone Width) - Codes 1-11
4. **ضخامت سنگ** (Stone Thickness) - Codes 1-6
5. **نام معدن** (Mine Name) - Codes 001-019
6. **نوع پرداخت** (Finish Type) - Codes 1-13
7. **رنگ سنگ** (Stone Color) - Codes 1-19
8. **کیفیت / توضیح** (Quality/Description) - Codes 1-18

## 🪨 Product Categories Analysis

### 1. Cutting Dimensions (ابعاد برش)
- **طولی** (Longitudinal) - Code: 1
- **حکمی/تایل** (Tile/Block) - Code: 2
- **حجمی** (Volumetric) - Code: 3

### 2. Stone Types (جنس سنگ)
- **تراورتن** (Travertine) - Code: 1
- **مرمریت** (Marble) - Code: 2
- **کریستال ماربل** (Crystal Marble) - Code: 3
- **گرانیت** (Granite) - Code: 4
- **بازالت** (Basalt) - Code: 5
- **لایمستون** (Limestone) - Code: 6
- **آندوزیت** (Andesite) - Code: 7
- **ترااونیکس** (Travertine) - Code: 8
- **ترامیت** (Travertine) - Code: 9
- **سند استون** (Sandstone) - Code: 10
- **اونیکس** (Onyx) - Code: 11
- **آلاباستر** (Alabaster) - Code: 12

### 3. Stone Widths (عرض سنگ)
- **عرض 10** - Code: 1
- **عرض 15** - Code: 2
- **عرض 20** - Code: 3
- **عرض 25** - Code: 4
- **عرض 30** - Code: 5
- **عرض 35** - Code: 6
- **عرض 40** - Code: 7
- **عرض 50** - Code: 8
- **عرض 60** - Code: 9
- **عرض 70** - Code: 10
- **عرض 80** - Code: 11

### 4. Stone Thickness (ضخامت سنگ)
- **ضخامت 2CM** - Code: 1
- **ضخامت 3CM** - Code: 2
- **ضخامت 4CM** - Code: 3
- **ضخامت 5CM** - Code: 4
- **ضخامت 6CM** - Code: 5

### 5. Mine Names (نام معدن)
- **عباس آباد** - Code: 001
- **یزد** - Code: 002
- **کاشان** - Code: 003
- **نطنز** - Code: 004
- **مشهد** - Code: 005
- **نهبندان** - Code: 006
- **مروارید** - Code: 007
- **خوی** - Code: 008
- **سلماس** - Code: 009
- **ازنا** - Code: 010
- **نی ریز** - Code: 011
- **بیرجند** - Code: 012
- **پیرانشهر** - Code: 013
- **اردستان** - Code: 014
- **مهاباد** - Code: 015
- **محلات** - Code: 016
- **میمه** - Code: 017
- **سیرجان** - Code: 018
- **مرودشت** - Code: 019

### 6. Finish Types (نوع پرداخت)
- **صیقل** (Polished) - Code: 1
- **خام** (Raw) - Code: 2
- **ساب صفر** (Zero Sand) - Code: 3
- **چرمی** (Leather) - Code: 4
- **هوند** (Honed) - Code: 5
- **فلیم** (Flamed) - Code: 6
- **اسکراچ** (Scratched) - Code: 7
- **شیار** (Grooved) - Code: 8
- **سند بلاست** (Sand Blast) - Code: 9
- **تیشه** (Chiseled) - Code: 10
- **بوش همر** (Bush Hammer) - Code: 11
- **کات همر** (Cut Hammer) - Code: 12
- **کات بروکن** (Cut Broken) - Code: 13

### 7. Stone Colors (رنگ سنگ)
- **سفید** (White) - Code: 1
- **کرم روشن** (Light Cream) - Code: 2
- **کرم** (Cream) - Code: 3
- **عسلی** (Honey) - Code: 4
- **شکلاتی** (Chocolate) - Code: 5
- **طوسی** (Gray) - Code: 6
- **بژ** (Beige) - Code: 7
- **سیلور** (Silver) - Code: 8
- **مشکی** (Black) - Code: 9
- **قرمز** (Red) - Code: 10
- **زرد** (Yellow) - Code: 11
- **آبی** (Blue) - Code: 12
- **هلویی** (Peach) - Code: 13
- **سماقی** (Plum) - Code: 14
- **گوجه ای** (Tomato) - Code: 15
- **فلفل نمکی** (Salt Pepper) - Code: 16
- **نسکافه ای** (Coffee) - Code: 17
- **دانه اناری** (Pomegranate Seed) - Code: 18
- **فیروزه ای** (Turquoise) - Code: 19

### 8. Quality/Description (کیفیت / توضیح)
- **سوپر** (Super) - Code: 1
- **ممتاز** (Excellent) - Code: 2
- **درجه یک** (First Grade) - Code: 3
- **درجه دو** (Second Grade) - Code: 4

## 🏗️ Product Model Design

Based on the Excel analysis, here's the recommended product model:

```typescript
interface Product {
  id: string;
  code: string; // Generated from combination of all codes
  name: string; // Generated from all attributes
  namePersian: string; // Persian name
  
  // Product Attributes
  cuttingDimension: {
    code: number;
    name: string;
    namePersian: string;
  };
  
  stoneType: {
    code: number;
    name: string;
    namePersian: string;
  };
  
  width: {
    code: number;
    value: number; // in CM
    name: string;
  };
  
  thickness: {
    code: number;
    value: number; // in CM
    name: string;
  };
  
  mine: {
    code: string;
    name: string;
    namePersian: string;
  };
  
  finish: {
    code: number;
    name: string;
    namePersian: string;
  };
  
  color: {
    code: number;
    name: string;
    namePersian: string;
  };
  
  quality: {
    code: number;
    name: string;
    namePersian: string;
  };
  
  // Pricing and Availability
  basePrice: number;
  currency: string;
  isAvailable: boolean; // Manager manually updates
  leadTime?: number; // days
  
  // Additional Info
  description?: string;
  images?: string[];
  isActive: boolean;
  
  createdAt: Date;
  updatedAt: Date;
}

// Product Code Generation
// Format: {cuttingDimension}{stoneType}{width}{thickness}{mine}{finish}{color}{quality}
// Example: 1234001001101 (Travertine, Longitudinal, 10cm width, 2cm thickness, Abbas Abad, Polished, White, Super)
```

## 🔧 Implementation Strategy

### 1. Database Schema
```sql
CREATE TABLE Product (
  id UUID PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(500) NOT NULL,
  namePersian VARCHAR(500) NOT NULL,
  
  -- Attributes
  cutting_dimension_code INTEGER,
  cutting_dimension_name VARCHAR(100),
  cutting_dimension_name_persian VARCHAR(100),
  
  stone_type_code INTEGER,
  stone_type_name VARCHAR(100),
  stone_type_name_persian VARCHAR(100),
  
  width_code INTEGER,
  width_value DECIMAL(5,2),
  width_name VARCHAR(100),
  
  thickness_code INTEGER,
  thickness_value DECIMAL(5,2),
  thickness_name VARCHAR(100),
  
  mine_code VARCHAR(10),
  mine_name VARCHAR(100),
  mine_name_persian VARCHAR(100),
  
  finish_code INTEGER,
  finish_name VARCHAR(100),
  finish_name_persian VARCHAR(100),
  
  color_code INTEGER,
  color_name VARCHAR(100),
  color_name_persian VARCHAR(100),
  
  quality_code INTEGER,
  quality_name VARCHAR(100),
  quality_name_persian VARCHAR(100),
  
  -- Pricing and Availability
  base_price DECIMAL(15,2),
  currency VARCHAR(10) DEFAULT 'RIAL',
  is_available BOOLEAN DEFAULT TRUE,
  lead_time INTEGER,
  
  -- Additional Info
  description TEXT,
  images TEXT[], -- Array of image URLs
  is_active BOOLEAN DEFAULT TRUE,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_product_code ON Product(code);
CREATE INDEX idx_product_stone_type ON Product(stone_type_code);
CREATE INDEX idx_product_mine ON Product(mine_code);
CREATE INDEX idx_product_available ON Product(is_available);
```

### 2. Import Process
1. **Parse Excel File**: Read all 102 product combinations
2. **Generate Product Codes**: Create unique codes for each combination
3. **Create Product Names**: Generate descriptive names in Persian
4. **Import to Database**: Bulk insert all products
5. **Set Default Pricing**: Set base prices (to be updated by manager)

### 3. Product Selection Interface
- **Multi-level Filtering**: Filter by stone type, color, finish, etc.
- **Search Functionality**: Search by name, code, or attributes
- **Visual Selection**: Show product images and specifications
- **Price Display**: Show base price with seller adjustment capability

## 📊 Product Statistics

### Total Product Combinations
- **Cutting Dimensions**: 3 types
- **Stone Types**: 12 types
- **Widths**: 11 sizes
- **Thicknesses**: 5 sizes
- **Mines**: 19 locations
- **Finishes**: 13 types
- **Colors**: 19 colors
- **Quality**: 4 grades

**Total Possible Combinations**: 3 × 12 × 11 × 5 × 19 × 13 × 19 × 4 = **3,895,920** possible combinations

**Actual Products in Excel**: 102 products (representative samples)

## 🎯 Next Steps

1. **Create Product Import Script**: Parse Excel and import to database
2. **Design Product Selection Interface**: Multi-filter product selection
3. **Implement Pricing System**: Base price + seller adjustments
4. **Add Product Management**: CRUD operations for products
5. **Integrate with Contract Creation**: Product selection in step 4

---

**Last Updated**: September 21, 2025  
**Analysis By**: Development Team  
**Excel File**: kala-kod.xls (102 products)
