import { babelParse, parse, SFCScriptBlock } from "@vue/compiler-sfc";
import traverse, { NodePath } from "@babel/traverse";
import * as t from "@babel/types";
import { ArrayExpression, ObjectExpression } from "@babel/types";
import Template from "./template";
import {
  getPropsByObject,
  getAstValue,
  getEmitsByArray,
  getMethodsByObject,
} from "./handle";
import { toLine } from "./utils";
import { Route } from "./route";
import { Emit, Method, Prop, RenderData } from "./type";

// 组件信息
export interface Component {
  name: string;
  emits: Emit[];
  props: Prop[];
  methods: Method[];
}

// 返回html
export function transformMain(
  code: string,
  routes: Route[],
  url: string
): { html: string; component: Component } | null {
  const { descriptor, errors } = parse(code);

  if (errors.length) {
    console.error(errors);
    return null;
  }

  if (descriptor.script) {
    const componentData = handleScript(descriptor.script);
    const result = componentToLayoutData(componentData);
    return {
      html: Template({
        content: result,
        route: {
          path: url,
          list: routes,
        },
      }),
      component: componentData,
    };
  }

  return null;
}

export function handleScript(script: SFCScriptBlock): Component {
  const ast = babelParse(script.content, {
    sourceType: "module",
    plugins: script.lang === "ts" ? ["typescript"] : [],
  });

  let component: Component = {
    name: "",
    props: [],
    emits: [],
    methods: [],
  };

  traverse(ast, {
    enter(path: NodePath) {
      // export default defineComponent({})
      if (path.isCallExpression()) {
        path.node.arguments.map((item) => {
          if (t.isObjectExpression(item)) {
            component = handleExportDefault(item);
          }
        });
      }
      // export default {}
      else if (path.isExportDefaultDeclaration()) {
        const declaration = path.node.declaration;
        if (t.isObjectExpression(declaration)) {
          component = handleExportDefault(declaration);
        }
      }
    },
  });

  return component;
}

/**
 * 解析
 * export default {} 和
 * export default defineComponent({}) 中的 json 对象
 * @param ast: ObjectExpression
 */
function handleExportDefault(ast: ObjectExpression): Component {
  let props: Prop[] = [];
  let emits: Emit[] = [];
  let methods: Method[] = [];
  let componentName = "";

  ast.properties.map((vueParams) => {
    // data() {}
    // if (t.isObjectMethod(vueParams)) {
    // }

    // name, props, emits, methods
    if (t.isObjectProperty(vueParams)) {
      const name = getAstValue(vueParams.key);
      switch (name) {
        // 组件名称
        case "name": {
          componentName = toLine(
            getAstValue(vueParams.value)
          ).toLocaleLowerCase();
          break;
        }

        case "props": {
          props = getPropsByObject(vueParams.value as ObjectExpression);
          break;
        }

        case "emits": {
          emits = getEmitsByArray(vueParams.value as ArrayExpression);
          break;
        }

        case "methods": {
          methods = getMethodsByObject(vueParams.value as ObjectExpression);
          break;
        }
      }
    }
  });

  return {
    name: componentName,
    props,
    emits,
    methods,
  };
}

// 将component 转换为 模板可用数据
// 如果是 undefined null "" 的转换，都在此方法中
function componentToLayoutData(component: Component): RenderData {
  const { props, emits, name, methods } = component;
  const json: RenderData = {
    name,
  };
  if (props && props.length) {
    json.props = {
      h3: "Props",
      table: {
        headers: ["参数", "说明", "类型", "默认值", "必填"],
        rows: props.map((item) => {
          return [
            item.name as string,
            item.notes || "",
            item.type as string,
            item.default || "-",
            item.required ? "true" : "false",
          ];
        }),
      },
    };
  }

  if (emits && emits.length) {
    json.emits = {
      h3: "Emits",
      table: {
        headers: ["事件", "说明", "回调参数"],
        rows: emits.map((item) => {
          return [item.name as string, item.notes as string, "-"];
        }),
      },
    };
  }

  if (methods && methods.length) {
    json.methods = {
      h3: "Methods",
      table: {
        headers: ["方法名", "说明", "参数: 说明", "返回值"],
        rows: methods.map((method) => {
          return [
            method.name,
            method.desc,
            method.params?.length
              ? method.params.map((item) => {
                  return `${item.name}: ${item.notes}`;
                })
              : "-",
            method.return || "-",
          ];
        }),
      },
    };
  }

  return json;
}
