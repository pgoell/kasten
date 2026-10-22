/**
 * The colours of Sanzo Wada's A Dictionary of Color Combinations, each with the
 * numbers of the combinations it appears in. `palettes.ts` reads a palette's
 * Wada neighbours off these numbers.
 *
 * Data from github.com/mattdesl/dictionary-of-colour-combinations (colors.json):
 *
 * The MIT License (MIT)
 * Copyright (c) 2020 Matt DesLauriers
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
 * IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
 * DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
 * OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE
 * OR OTHER DEALINGS IN THE SOFTWARE.
 */

export interface WadaColour {
  name: string;
  hex: string;
  combinations: readonly number[];
}

// Name, hex and combinations, in the dataset's order.
const ROWS: readonly [string, string, readonly number[]][] = [
  ["Hermosa Pink", "#f9c1ce", [176, 227, 273]],
  ["Corinthian Pink", "#f8b6ba", [27, 43, 87, 97, 128, 169, 174, 206, 246, 254, 264, 342]],
  ["Cameo Pink", "#e0b3b6", [101, 105, 116, 120, 165, 231]],
  ["Fawn", "#d1b0a7", [18, 125, 308]],
  ["Light Brown Drab", "#b59392", [35, 68, 185, 191, 223, 239, 244, 268, 285, 321]],
  ["Coral Red", "#f58e84", [92, 123, 320, 332]],
  ["Fresh Color", "#f6917e", [240]],
  ["Grenadine Pink", "#f48067", [6, 21, 112, 166, 193, 201, 230, 300, 315, 341]],
  ["Eosine Pink", "#f37f94", [34, 59, 90, 108, 134, 153, 197, 242, 248, 276, 287, 314, 327, 336]],
  ["Spinel Red", "#f27291", [14, 147, 165, 184, 195, 224, 277]],
  ["Old Rose", "#d46d7a", [55, 162, 260, 265]],
  ["Eugenia Red | A", "#e2625e", [284]],
  ["Eugenia Red | B", "#da525d", [17, 77, 252, 262, 270, 280, 282, 325]],
  [
    "Raw Sienna",
    "#bb7125",
    [3, 13, 33, 70, 86, 130, 131, 182, 243, 247, 252, 255, 268, 269, 279, 293, 298, 319, 327],
  ],
  ["Vinaceous Tawny", "#c56127", [40, 85, 244]],
  ["Jasper Red", "#eb5324", [155, 194, 216, 219]],
  ["Spectrum Red", "#e31f26", [257, 266, 301, 322]],
  ["Red Orange", "#dd4027", [31, 164, 179, 241, 264]],
  ["Etruscan Red", "#c55347", [25, 47, 97, 137, 152, 185, 275]],
  ["Burnt Sienna", "#ae5224", [198, 242, 263, 285, 286, 297, 312, 333, 343]],
  ["Ochre Red", "#ab544d", [199, 283]],
  ["Scarlet", "#cb2f43", [136, 308, 332]],
  ["Carmine", "#cc1236", [39, 117, 122, 154, 225, 232, 307, 313]],
  ["Indian Lake", "#c53c69", [299, 331]],
  ["Rosolanc Purple", "#b73f74", [48, 144, 170, 204, 277, 346]],
  ["Pomegranite Purple", "#b71f57", [220, 271]],
  ["Hydrangea Red", "#a94151", [142]],
  ["Brick Red", "#a84222", [37, 108, 246, 322, 328]],
  ["Carmine Red", "#a62c37", [35, 51, 104, 130, 181, 200, 221, 228, 233, 237, 245, 338]],
  ["Pompeian Red", "#ab2439", [30, 71, 120, 212, 311, 324]],
  ["Red", "#a72144", [251, 261]],
  ["Brown", "#7c4226", [110, 121, 145, 161]],
  ["Hay's Russet", "#793327", [58, 82, 95, 152, 186, 231, 249, 304, 314, 336, 345]],
  ["Vandyke Red", "#82241f", [16, 133, 147, 316, 335]],
  ["Pansy Purple", "#7d133a", [157, 273]],
  ["Pale Burnt Lake", "#802626", [124, 171, 177, 205, 217, 258, 269, 283]],
  ["Violet Red", "#642d5e", [9]],
  ["Vistoris Lake", "#6d4145", [63, 91, 165, 226, 290, 337]],
  [
    "Sulpher Yellow",
    "#f5ecc2",
    [52, 72, 80, 104, 132, 135, 151, 208, 246, 254, 270, 294, 296, 310, 315, 320, 321, 326],
  ],
  [
    "Pale Lemon Yellow",
    "#ffefae",
    [3, 31, 60, 76, 99, 109, 111, 169, 185, 195, 203, 228, 241, 261, 272, 281, 290, 292, 336],
  ],
  ["Naples Yellow", "#fbe6a0", [14, 115, 166, 193, 303, 325]],
  [
    "Ivory Buff",
    "#ebd3a2",
    [11, 50, 94, 102, 126, 178, 184, 190, 209, 214, 235, 243, 262, 266, 301, 343],
  ],
  ["Seashell Pink", "#fdd4bd", [45, 84, 88, 113, 150, 176, 194, 276, 334]],
  ["Light Pinkish Cinnamon", "#fcc79b", [317]],
  ["Pinkish Cinnamon", "#eeb480", [78, 161, 175, 232, 258, 263, 292, 305, 310]],
  ["Cinnamon Buff", "#fdc57e", [23, 127, 137, 180, 210, 234, 246, 323, 344]],
  [
    "Cream Yellow",
    "#fdbf68",
    [122, 192, 215, 226, 267, 278, 294, 295, 300, 302, 304, 311, 329, 342],
  ],
  ["Golden Yellow", "#f3a257", [26, 81, 132, 138, 140, 179, 206, 229, 309, 315]],
  ["Vinaceous Cinnamon", "#eea78c", [203, 205, 213, 256, 260, 279, 299]],
  ["Ochraceous Salmon", "#d8a37b", [32, 71, 121, 186, 217, 220, 223, 238, 296, 339]],
  ["Isabella Color", "#c5a56e", [4, 12, 241, 292]],
  ["Maple", "#c59f6b", [282]],
  ["Olive Buff", "#c1c494", [83, 175, 200, 330, 348]],
  ["Ecru", "#c2ae93", [167, 249, 275, 279, 292, 302, 317, 327]],
  ["Yellow", "#fff200", [22, 62, 68, 154, 240, 251, 295, 313]],
  [
    "Lemon Yellow",
    "#f8ed43",
    [45, 123, 138, 158, 168, 173, 189, 210, 253, 259, 289, 298, 306, 317, 333],
  ],
  ["Apricot Yellow", "#ffdd00", [107, 129, 163, 198, 213, 247, 265, 284, 305, 319]],
  ["Pyrite Yellow", "#cab356", [239, 250, 255, 287]],
  ["Olive Ocher", "#d6b43e", [66, 148, 149, 156, 157, 249, 278]],
  ["Yellow Ocher", "#e2b540", [42, 96, 118, 124, 126, 191, 222, 325]],
  ["Orange Yellow", "#fcb315", [114, 148, 153, 164, 170, 257, 286, 338]],
  ["Yellow Orange", "#f99d1b", [2, 53, 89, 151, 171, 209, 222, 235, 267, 288, 297, 312, 319, 335]],
  ["Apricot Orange", "#f68c50", [211, 253, 309, 328]],
  ["Orange", "#f37420", [7, 46, 141, 144, 149, 256, 272]],
  ["Peach Red", "#f15a30", [115, 250, 274, 285, 298, 303, 326, 340]],
  ["English Red", "#d96629", [1, 131, 190, 308, 339]],
  ["Cinnamon Rufous", "#c27544", [8, 10, 103, 158, 172, 204, 206]],
  ["Orange Rufous", "#c16b27", [91, 102, 222]],
  ["Sulphine Yellow", "#c19f2c", [36, 65, 142, 160, 252]],
  ["Khaki", "#bc892b", [129, 146, 159, 236, 248]],
  ["Citron Yellow", "#b2b73e", [40, 87, 145, 150, 153, 196, 305, 323]],
  ["Citrine", "#b09f36", [59, 93, 132, 133, 262]],
  ["Buffy Citrine", "#96874d", [100, 177, 233]],
  ["Dark Citrine", "#8b835b", [10, 41, 274, 304]],
  ["Light Grayish Olive", "#848061", [107, 184]],
  ["Krongbergs Green", "#84875e", [29]],
  ["Olive", "#837e31", [96, 201, 254, 258, 277, 310, 334]],
  ["Orange Citrine", "#986f2d", [212, 342]],
  ["Sudan Brown", "#a36752", [207, 214, 273]],
  ["Olive Green", "#6b7140", [66, 243, 270, 297]],
  ["Light Brownish Olive", "#806e4b", [199, 318]],
  ["Deep Grayish Olive", "#635a3a", [146, 343]],
  ["Pale Raw Umber", "#71502f", [26, 73, 160, 234, 296]],
  ["Sepia", "#644b1e", [24, 288]],
  ["Madder Brown", "#762c19", [28, 79, 98, 173, 237, 275, 323]],
  ["Mars Brown Tobacco", "#653514", [19]],
  ["Vandyke Brown", "#4b3317", [110, 113, 118, 182, 192, 328]],
  [
    "Turquoise Green",
    "#b5decc",
    [36, 74, 147, 163, 173, 202, 223, 230, 263, 272, 285, 293, 300, 305, 317, 346],
  ],
  ["Glaucous Green", "#b4cdc2", [7, 150, 171, 207, 239, 260]],
  ["Dark Greenish Glaucous", "#b7c2a9", [264, 311]],
  ["Yellow Green", "#afd472", [111, 141, 276, 326, 334]],
  ["Light Green Yellow", "#c7d14f", [61, 289, 291, 311, 346]],
  ["Night Green", "#87c540", [19, 32, 158, 326]],
  ["Olive Yellow", "#a6a159", [124, 211, 265, 347]],
  ["Artemesia Green", "#709390", [293, 312]],
  ["Andover Green", "#6d7e77", [244, 346]],
  ["Rainette Green", "#8fa071", [73, 162, 188, 266, 301]],
  ["Chromium Green", "#719470", [105, 200, 219, 283]],
  ["Pistachio Green", "#648f7b", [127, 137]],
  ["Sea Green", "#00b49b", [17, 21, 58, 86, 133, 250, 260, 284, 291, 340, 347]],
  ["Benzol Green", "#00978d", [15, 54, 92, 122, 155, 247, 266, 267, 281, 304, 306]],
  ["Light Porcelain Green", "#00908a", [44, 193, 328]],
  ["Green", "#489b6e", [198, 216, 293]],
  ["Dull Viridian Green", "#009465", [136, 256, 306, 316]],
  ["Oil Green", "#819238", [245, 299, 320]],
  ["Diamine Green", "#1a7444", [38, 146, 217, 242, 251, 313]],
  ["Cossack Green", "#437742", [5, 135, 262, 270, 278, 294, 319, 341, 348]],
  ["Lincoln Green", "#555832", [70, 121, 203, 210, 280, 290]],
  ["Blackish Olive", "#42533e", [109, 318, 336]],
  ["Deep Slate Olive", "#253122", [189, 229, 268, 303, 310, 321, 332, 341, 342, 348]],
  ["Nile Blue", "#bce4e5", [25, 250, 268, 302, 306, 330, 345]],
  ["Pale King's Blue", "#a7d4e4", [16, 49, 72, 75, 167, 196, 213, 234, 287]],
  ["Light Glaucous Blue", "#a5c8d1", [54, 93, 119, 152, 178, 204, 227, 320, 339, 341]],
  ["Salvia Blue", "#97acc8", [29, 129, 135, 139, 142, 188, 209, 212, 237, 272, 294, 321, 330]],
  ["Cobalt Green", "#96d1aa", [156, 188, 201, 202, 230, 271, 281, 282, 290, 291, 308, 333]],
  ["Calamine BLue", "#78cdd0", [20, 41, 65, 159, 176, 255, 261, 287, 291, 300]],
  ["Venice Green", "#62c6bf", [78, 128, 138, 189, 283, 345]],
  ["Cerulian Blue", "#0093a5", [1, 63, 99, 125, 148, 227, 240, 264]],
  ["Peacock Blue", "#00939b", [131, 286]],
  ["Green Blue", "#099197", [12, 74, 79, 178, 208, 252, 259, 271, 330]],
  ["Olympic Blue", "#5a82b3", [44, 67, 157, 194, 231, 274, 324]],
  ["Blue", "#006eb8", [49, 51, 88, 143, 154, 186, 191, 215, 257, 267, 295, 333]],
  ["Antwarp Blue", "#007190", [85, 106, 114, 140, 163, 172, 208, 244, 258, 281, 299, 302, 334]],
  ["Helvetia Blue", "#005b8d", [39, 48, 161, 187, 218, 259, 312, 347]],
  ["Dark Medici Blue", "#547076", [160, 224, 241, 249]],
  ["Dusky Green", "#004f46", [94, 219, 225, 278, 284, 318, 332, 338]],
  ["Deep Lyons Blue", "#1c4286", [22, 38, 101, 126, 179, 199, 236, 247, 314, 344]],
  ["Violet Blue", "#40456a", [75, 83, 89, 98, 125, 233, 286, 289, 297, 309, 339]],
  ["Vandar Poel's Blue", "#064f6e", [5, 77, 151, 167, 168, 309, 343]],
  ["Dark Tyrian Blue", "#12354e", [2, 60, 67, 119, 141, 245, 279]],
  ["Dull Violet Black", "#1e0e3f", [95, 106, 145, 265, 277, 289, 295, 331]],
  ["Deep Indigo", "#051230", [6, 28, 139, 155, 182, 211, 232]],
  ["Deep Slate Green", "#112f2c", [84, 149, 166, 271, 318, 325]],
  ["Grayish Lavender - A", "#b5b1d8", [8, 15, 159, 177, 218, 248, 307]],
  ["Grayish Lavender - B", "#c0a9b3", [47, 56, 174, 187, 235, 327, 329, 338]],
  ["Laelia Pink", "#ca92a8", [20, 254, 280, 337]],
  ["Lilac", "#b984af", [143, 162, 282, 347]],
  ["Eupatorium Purple", "#bf5892", [215, 315, 322]],
  ["Light Mauve", "#9a72aa", [23, 80, 128, 134, 180, 274, 331]],
  ["Aconite Violet", "#a36aa5", [43, 64, 90, 187, 220, 257, 269, 301, 307, 324, 344]],
  ["Dull Blue Violet", "#80719e", [9, 100]],
  ["Dark Soft Violet", "#66629c", [64, 127, 197]],
  ["Blue Violet", "#6450a1", [116, 175, 196, 322, 345]],
  ["Purple Drab", "#84565b", [236]],
  ["Deep Violet / Plumbeous", "#70727c", [183, 192, 218]],
  ["Veronia Purple", "#8c4c62", [13, 24, 168, 183]],
  ["Dark Slate Purple", "#704357", [225, 248]],
  ["Taupe Brown", "#7a4456", [57, 123, 174, 224, 275, 280, 288]],
  ["Violet Carmine", "#713b4c", [337]],
  ["Violet", "#4f4086", [42, 56, 130, 156, 164, 181, 205, 214, 226, 316, 331, 335]],
  ["Red Violet", "#59256a", [4, 37, 134, 136, 170, 172, 183, 316]],
  ["Cotinga Purple", "#501345", [61, 181, 238, 253, 307, 329, 348]],
  ["Dusky Madder Violet", "#4e1d4c", [18, 50, 53, 82, 103, 314]],
  ["White", "#ffffff", [55]],
  ["Neutral Gray", "#b6bfc1", [34, 139, 180, 195, 197, 221, 228, 229, 273, 303, 324, 340]],
  ["Mineral Gray", "#a2b0ad", [11, 30]],
  ["Warm Gray", "#a1a39a", [69, 76, 81, 143, 169, 238, 259, 261]],
  ["Slate Color", "#34454c", [27, 33, 57, 140, 202, 243, 245, 251, 253, 263, 296, 329, 335]],
  [
    "Black",
    "#111314",
    [
      46, 52, 62, 69, 112, 117, 144, 190, 207, 216, 221, 242, 255, 256, 269, 276, 288, 298, 313,
      323, 337, 340, 344,
    ],
  ],
];

export const WADA: readonly WadaColour[] = ROWS.map(([name, hex, combinations]) => ({
  name,
  hex,
  combinations,
}));
