/**
 * Charmé Edit design tokens for Ant Design's ConfigProvider.
 * Warm cream canvas, dusty-rouge primary, antique-gold accents — echoing the
 * thecharmeedit.com aesthetic (Cormorant Garamond display + Helvetica body).
 */
export const charme = {
  cream: '#F7F1E8',
  creamDeep: '#EFE6D8',
  paper: '#FFFFFF',
  ink: '#2E2A26',
  inkSoft: '#6F665C',
  rouge: '#A8524C',
  rougeDeep: '#8C3F3A',
  gold: '#BFA15F',
  blush: '#E7C9C2',
  sage: '#9FAE94',
  line: '#E4D8C7',
}

export const theme = {
  token: {
    colorPrimary: charme.rouge,
    colorInfo: charme.rouge,
    colorTextBase: charme.ink,
    colorBgLayout: charme.cream,
    colorBorder: charme.line,
    colorBorderSecondary: '#EEE6D9',
    borderRadius: 10,
    fontFamily:
      "'Helvetica Neue', Helvetica, Arial, sans-serif",
    fontSize: 14,
    controlHeight: 38,
    wireframe: false,
  },
  components: {
    Button: {
      controlHeight: 42,
      fontWeight: 500,
      primaryShadow: 'none',
      defaultBorderColor: charme.ink,
    },
    Segmented: {
      itemSelectedBg: charme.rouge,
      itemSelectedColor: '#fff',
      trackBg: '#EFE6D8',
      controlHeight: 40,
    },
    Tabs: {
      inkBarColor: charme.rouge,
      itemSelectedColor: charme.rouge,
      itemHoverColor: charme.rougeDeep,
      titleFontSize: 15,
    },
    Drawer: { paddingLG: 18 },
    Card: { colorBorderSecondary: charme.line },
    Slider: {
      trackBg: charme.rouge,
      trackHoverBg: charme.rougeDeep,
      handleColor: charme.rouge,
    },
    Modal: { borderRadiusLG: 16 },
  },
}
