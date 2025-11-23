/**
 * wagmi配置文件 - 用于设置和管理Web3钱包连接
 * 该文件定义了Uniswap界面使用的各种钱包连接器、RPC端点配置和客户端设置
 */

// 导入各种钱包连接器和配置
import { getWagmiConnectorV2 } from '@binance/w3w-wagmi-connector-v2' // Binance钱包连接器
import { PLAYWRIGHT_CONNECT_ADDRESS } from 'components/Web3Provider/constants' // 测试环境使用的连接地址
import { createRejectableMockConnector } from 'components/Web3Provider/rejectableConnector' // 可拒绝的模拟连接器(用于测试)
import { WC_PARAMS } from 'components/Web3Provider/walletConnect' // WalletConnect配置参数
import { embeddedWallet } from 'connection/EmbeddedWalletConnector' // 嵌入式钱包连接器
import { porto } from 'porto/wagmi' // Porto钱包连接器

// 导入UI和常量
import { UNISWAP_LOGO } from 'ui/src/assets' // Uniswap标志
import { UNISWAP_WEB_URL } from 'uniswap/src/constants/urls' // Uniswap网站URL
import { CONNECTION_PROVIDER_IDS } from 'uniswap/src/constants/web3' // 连接提供商ID常量

// 导入链信息相关工具
import type { getChainInfo } from 'uniswap/src/features/chains/chainInfo' // 链信息获取函数类型
import { ORDERED_EVM_CHAINS } from 'uniswap/src/features/chains/chainInfo' // 有序的EVM链列表
import { isTestnetChain } from 'uniswap/src/features/chains/utils' // 检测是否为测试网的工具函数

// 导入环境和工具函数
import { isPlaywrightEnv, isTestEnv } from 'utilities/src/environment/env' // 环境检测函数
import { logger } from 'utilities/src/logger/logger' // 日志工具
import { getNonEmptyArrayOrThrow } from 'utilities/src/primitives/array' // 数组工具函数

// 导入viem和wagmi核心库
import type { Chain } from 'viem' // viem链类型
import { createClient } from 'viem' // 创建viem客户端
import type { Config } from 'wagmi' // wagmi配置类型
import { createConfig, fallback, http } from 'wagmi' // wagmi配置和传输相关函数
import { coinbaseWallet, injected, safe, walletConnect } from 'wagmi/connectors' // 各种钱包连接器

/**
 * 根据当前环境获取适当的Binance钱包连接器
 * 该函数会智能检测是否安装了Binance浏览器扩展，并据此返回不同的连接器实例
 */
const getBinanceConnector = () => {
  // 检查是否检测到Binance扩展
  const isBinanceDetected = 
    typeof window !== 'undefined' && (window.BinanceChain || (window.binancew3w && window.binancew3w.ethereum))

  // 检查是否安装了TrustWallet扩展（它会使用BinanceChain对象）
  const isTrustWalletExtensionInstalled = typeof window !== 'undefined' && window.BinanceChain?.isTrustWallet

  // 确定是否安装了真正的Binance扩展（而非TrustWallet）
  const isBinanceExtensionInstalled = isBinanceDetected && !isTrustWalletExtensionInstalled

  // 如果安装了Binance扩展，直接使用injected连接器
  // 这避免了Binance连接器自带的检测逻辑可能带来的问题
  if (isBinanceExtensionInstalled) {
    return injected({
      target: {
        id: CONNECTION_PROVIDER_IDS.BINANCE_WALLET_CONNECTOR_ID,
        name: 'Binance Wallet',
        // @ts-expect-error - window.BinanceChain和window.binancew3w.ethereum的类型我们已尽力定义
        provider: () => window.BinanceChain || window.binancew3w?.ethereum,
      },
    })
  }

  // 否则，使用带QR码模态框的Binance连接器（用于移动设备连接）
  const BinanceConnector = getWagmiConnectorV2()
  return BinanceConnector({
    showQrCodeModal: true,
  })
}

/**
 * 获取按优先级排序的链RPC传输URL列表
 * 按以下优先级排序：interface > default > public > fallback
 * 并去除重复和空值
 * 
 * @param chain 链信息对象
 * @returns 排序后的RPC URL数组
 */
export const orderedTransportUrls = (chain: ReturnType<typeof getChainInfo>): string[] => {
  // 按优先级顺序合并所有RPC URL
  const orderedRpcUrls = [
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    ...(chain.rpcUrls.interface?.http ?? []), // 界面专用RPC（最高优先级）
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    ...(chain.rpcUrls.default?.http ?? []), // 默认RPC
    ...(chain.rpcUrls.public?.http ?? []), // 公共RPC
    ...(chain.rpcUrls.fallback?.http ?? []), // 备用RPC（最低优先级）
  ]

  // 过滤掉空值并去重，确保每个URL都是唯一的
  return Array.from(new Set(orderedRpcUrls.filter(Boolean)))
}

/**
 * 创建Wagmi钱包连接器列表
 * 根据环境配置不同的钱包连接器，包括真实钱包和测试用模拟钱包
 * 
 * @param params 配置参数
 * @param params.includeMockConnector 是否包含模拟连接器（用于Playwright测试）
 * @returns 钱包连接器数组
 */
function createWagmiConnectors(params: {
  /** If `true`, appends the wagmi `mock` connector. Used in Playwright. */
  includeMockConnector: boolean
}): any[] {
  const { includeMockConnector } = params

  // 基础钱包连接器列表（按优先级排序）
  const baseConnectors = [
    porto(), // Porto钱包连接器
    // Binance connector - uses injected for extension, QR code for mobile
    getBinanceConnector(), // Binance钱包连接器（智能选择扩展或QR码模式）
    // There are no unit tests that expect WalletConnect to be included here,
    // so we can disable it to reduce log noise.
    ...(isTestEnv() && !isPlaywrightEnv() ? [] : [walletConnect(WC_PARAMS)]), // WalletConnect连接器（非测试环境或Playwright环境下使用）
    embeddedWallet(), // 嵌入式钱包连接器
    coinbaseWallet({
      appName: 'Uniswap',
      // CB SDK doesn't pass the parent origin context to their passkey site
      // Flagged to CB team and can remove UNISWAP_WEB_URL once fixed
      appLogoUrl: `${UNISWAP_WEB_URL}${UNISWAP_LOGO}`, // Coinbase钱包应用logo URL
      reloadOnDisconnect: false, // 断开连接时不重新加载页面
    }),
    safe(), // Gnosis Safe多签钱包连接器
  ]

  // 根据是否需要模拟连接器决定最终返回的连接器列表
  return includeMockConnector
    ? [
        ...baseConnectors,
        // 添加用于Playwright测试的模拟连接器
        createRejectableMockConnector({
          features: {},
          accounts: [PLAYWRIGHT_CONNECT_ADDRESS], // 使用预定义的测试地址
        }),
      ]
    : baseConnectors
}

/**
 * 创建Wagmi配置对象
 * 配置包括链信息、钱包连接器和RPC客户端设置
 * 
 * @param params 配置参数
 * @param params.connectors 钱包连接器列表
 * @param params.onFetchResponse 可选的响应处理函数，默认为defaultOnFetchResponse
 * @returns 配置好的wagmi Config对象
 */
function createWagmiConfig(params: {
  /** The connector list to use. */
  connectors: any[]
  /** Optional custom `onFetchResponse` handler – defaults to `defaultOnFetchResponse`. */
  onFetchResponse?: (response: Response, chain: Chain, url: string) => void
}): Config<typeof ORDERED_EVM_CHAINS> {
  const { connectors, onFetchResponse = defaultOnFetchResponse } = params

  // 创建wagmi配置对象
  return createConfig({
    // 设置支持的链列表，并确保不为空
    chains: getNonEmptyArrayOrThrow(ORDERED_EVM_CHAINS),
    // 使用提供的钱包连接器列表
    connectors,
    // 为每个链创建viem客户端
    client({ chain }) {
      return createClient({
        chain, // 当前链
        batch: { multicall: true }, // 启用批量调用以优化性能
        pollingInterval: 12_000, // 轮询间隔12秒
        // 使用fallback传输，当主RPC失败时自动切换到备用RPC
        transport: fallback(
          // 为每个排序后的RPC URL创建HTTP传输
          orderedTransportUrls(chain).map((url) =>
            http(url, { 
              onFetchResponse: (response) => onFetchResponse(response, chain, url) 
            }),
          ),
        ),
      })
    },
  })
}

/**
 * 默认的RPC响应处理函数
 * 根据链类型（测试网或主网）对非200状态码的响应进行不同级别的日志记录
 * 
 * @param response RPC响应对象
 * @param chain 当前链信息
 * @param url RPC请求URL
 */
// eslint-disable-next-line max-params
const defaultOnFetchResponse = (response: Response, chain: Chain, url: string) => {
  // 检查响应状态码是否为200
  if (response.status !== 200) {
    const message = `RPC provider returned non-200 status: ${response.status}`

    // 对测试网链仅记录警告日志
    if (isTestnetChain(chain.id)) {
      logger.warn('wagmiConfig.ts', 'client', message, {
        extra: {
          chainId: chain.id,
          url,
        },
      })
    } else {
      // 对主网链记录错误日志以便修复问题
      logger.error(new Error(message), {
        extra: {
          chainId: chain.id,
          url,
        },
        tags: {
          file: 'wagmiConfig.ts',
          function: 'client',
        },
      })
    }
  }
}

// 创建默认的钱包连接器列表
// 在Playwright测试环境中包含模拟连接器
const defaultConnectors = createWagmiConnectors({
  includeMockConnector: isPlaywrightEnv(),
})

// 创建并导出最终的wagmi配置对象
export const wagmiConfig = createWagmiConfig({ connectors: defaultConnectors })

// 声明wagmi模块扩展，确保TypeScript正确识别配置类型
declare module 'wagmi' {
  interface Register {
    // eslint-disable-next-line @typescript-eslint/consistent-type-imports
    config: typeof wagmiConfig
  }
}
