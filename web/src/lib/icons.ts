// 只內嵌用到的 Font Awesome 圖示（CC BY 4.0，授權說明保留在每個 SVG 的註解裡）
import arrowRight from '@fortawesome/fontawesome-free/svgs/solid/arrow-right.svg?raw';
import calendarCheck from '@fortawesome/fontawesome-free/svgs/regular/calendar-check.svg?raw';
import check from '@fortawesome/fontawesome-free/svgs/solid/check.svg?raw';
import chevronDown from '@fortawesome/fontawesome-free/svgs/solid/chevron-down.svg?raw';
import chevronLeft from '@fortawesome/fontawesome-free/svgs/solid/chevron-left.svg?raw';
import chevronRight from '@fortawesome/fontawesome-free/svgs/solid/chevron-right.svg?raw';
import circleExclamation from '@fortawesome/fontawesome-free/svgs/solid/circle-exclamation.svg?raw';
import circleNotch from '@fortawesome/fontawesome-free/svgs/solid/circle-notch.svg?raw';
import clock from '@fortawesome/fontawesome-free/svgs/regular/clock.svg?raw';
import cloudBolt from '@fortawesome/fontawesome-free/svgs/solid/cloud-bolt.svg?raw';
import circleInfo from '@fortawesome/fontawesome-free/svgs/solid/circle-info.svg?raw';
import coins from '@fortawesome/fontawesome-free/svgs/solid/coins.svg?raw';
import droplet from '@fortawesome/fontawesome-free/svgs/solid/droplet.svg?raw';
import eraser from '@fortawesome/fontawesome-free/svgs/solid/eraser.svg?raw';
import eye from '@fortawesome/fontawesome-free/svgs/regular/eye.svg?raw';
import eyeSlash from '@fortawesome/fontawesome-free/svgs/regular/eye-slash.svg?raw';
import flag from '@fortawesome/fontawesome-free/svgs/solid/flag.svg?raw';
import gear from '@fortawesome/fontawesome-free/svgs/solid/gear.svg?raw';
import heart from '@fortawesome/fontawesome-free/svgs/solid/heart.svg?raw';
import key from '@fortawesome/fontawesome-free/svgs/solid/key.svg?raw';
import minus from '@fortawesome/fontawesome-free/svgs/solid/minus.svg?raw';
import moon from '@fortawesome/fontawesome-free/svgs/solid/moon.svg?raw';
import mugHot from '@fortawesome/fontawesome-free/svgs/solid/mug-hot.svg?raw';
import paw from '@fortawesome/fontawesome-free/svgs/solid/paw.svg?raw';
import pen from '@fortawesome/fontawesome-free/svgs/solid/pen.svg?raw';
import penNib from '@fortawesome/fontawesome-free/svgs/solid/pen-nib.svg?raw';
import plus from '@fortawesome/fontawesome-free/svgs/solid/plus.svg?raw';
import pencil from '@fortawesome/fontawesome-free/svgs/solid/pencil.svg?raw';
import rotateRight from '@fortawesome/fontawesome-free/svgs/solid/rotate-right.svg?raw';
import sackDollar from '@fortawesome/fontawesome-free/svgs/solid/sack-dollar.svg?raw';
import trashCan from '@fortawesome/fontawesome-free/svgs/regular/trash-can.svg?raw';
import triangleExclamation from '@fortawesome/fontawesome-free/svgs/solid/triangle-exclamation.svg?raw';
import trophy from '@fortawesome/fontawesome-free/svgs/solid/trophy.svg?raw';
import xmark from '@fortawesome/fontawesome-free/svgs/solid/xmark.svg?raw';

export const icons = {
  arrowRight, calendarCheck, check, chevronDown, chevronLeft, chevronRight, circleExclamation, circleInfo, circleNotch, clock, cloudBolt, coins, droplet,
  eraser, eye, eyeSlash, flag, gear, heart, key, moon, mugHot, paw, minus, pen, penNib, pencil, plus, rotateRight, sackDollar,
  trashCan, triangleExclamation, trophy, xmark,
};

export type IconName = keyof typeof icons;

export const DAY_TYPE_ICONS: Record<string, IconName> = { 例假: 'moon', 休假: 'mugHot', 國定假日: 'flag' };
